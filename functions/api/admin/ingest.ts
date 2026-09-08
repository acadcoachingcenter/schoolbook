import { jsonResponse, errorResponse } from "../../_lib/env";
import { extractPdfPages, chunkPages, embedAndUpsertChunks, slug } from "../../_lib/ingest";
import { detectChapterInfo } from "../../_lib/detect";
import { upsertAvailableChapter } from "../../_lib/availability";
import { requireAdminKey, type AdminEnv } from "../../_lib/adminAuth";

interface IngestEnv extends AdminEnv {
  SOURCE_PDFS?: R2Bucket;
}

export const onRequestOptions: PagesFunction<IngestEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<IngestEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  const authError = await requireAdminKey(env, request, origin);
  if (authError) return authError;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected multipart/form-data with a 'file' field.", 400, origin);
  }

  const file = form.get("file");
  const className = form.get("className");
  const subjectName = form.get("subjectName");
  const bookOverride = form.get("book");
  const chapterTitleOverride = form.get("chapterTitle");

  if (!(file instanceof File)) return errorResponse("Missing 'file' (PDF upload).", 400, origin);
  if (typeof className !== "string" || !className.trim()) return errorResponse("Missing 'className'.", 400, origin);
  if (typeof subjectName !== "string" || !subjectName.trim())
    return errorResponse("Missing 'subjectName'.", 400, origin);

  const MAX_BYTES = 25 * 1024 * 1024; // 25MB — comfortably covers a single NCERT chapter PDF
  if (file.size > MAX_BYTES) {
    return errorResponse("File too large — split into smaller chapter-wise PDFs (under 25MB each).", 400, origin);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    const pages = await extractPdfPages(bytes);
    const detected = detectChapterInfo(pages);
    const chapterTitle =
      typeof chapterTitleOverride === "string" && chapterTitleOverride.trim()
        ? chapterTitleOverride.trim()
        : detected.chapterTitle;

    const subjectId = slug(`${className}-${subjectName}`);
    const chapterId = slug(chapterTitle);
    const book =
      typeof bookOverride === "string" && bookOverride.trim() ? bookOverride.trim() : `NCERT ${className} ${subjectName}`;

    // Best-effort: keep the original PDF in R2 for audit/re-processing. Never block ingestion on this.
    if (env.SOURCE_PDFS) {
      const key = `${subjectId}/${chapterId}.pdf`;
      env.SOURCE_PDFS.put(key, bytes).catch((err) => console.error("R2 store failed:", err));
    }

    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      return errorResponse(
        "No extractable text found in this PDF — it may be a scanned image without a text layer.",
        422,
        origin
      );
    }

    const count = await embedAndUpsertChunks(env, chunks, {
      subject: subjectId,
      chapter: chapterId,
      book,
      subjectName,
      chapterName: chapterTitle
    });

    await upsertAvailableChapter(env, {
      subjectId,
      chapterId,
      className,
      subjectName,
      chapterTitle,
      book,
      subtopics: detected.subtopics
    });

    return jsonResponse(
      { subjectId, chapterId, chapterTitle, subtopics: detected.subtopics, book, chunks: count },
      { status: 200 },
      origin
    );
  } catch (err) {
    console.error("admin/ingest.ts error:", err);
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return errorResponse(`Failed to process this PDF. ${detail}`, 500, origin);
  }
};
