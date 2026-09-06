import type { Env } from "../../_lib/env";
import { jsonResponse, errorResponse } from "../../_lib/env";
import { extractAndChunkPdf, embedAndUpsertChunks } from "../../_lib/ingest";

interface IngestEnv extends Env {
  ADMIN_INGEST_KEY: string;
  SOURCE_PDFS?: R2Bucket;
}

export const onRequestOptions: PagesFunction<IngestEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<IngestEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  if (!env.ADMIN_INGEST_KEY) {
    return errorResponse("Ingestion is not configured on this deployment.", 503, origin);
  }
  const providedKey = request.headers.get("X-Admin-Key");
  if (!providedKey || providedKey !== env.ADMIN_INGEST_KEY) {
    return errorResponse("Unauthorized.", 401, origin);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected multipart/form-data with a 'file' field.", 400, origin);
  }

  const file = form.get("file");
  const subject = form.get("subject");
  const chapter = form.get("chapter");
  const book = form.get("book");

  if (!(file instanceof File)) return errorResponse("Missing 'file' (PDF upload).", 400, origin);
  if (typeof subject !== "string" || !subject.trim()) return errorResponse("Missing 'subject'.", 400, origin);
  if (typeof chapter !== "string" || !chapter.trim()) return errorResponse("Missing 'chapter'.", 400, origin);
  if (typeof book !== "string" || !book.trim()) return errorResponse("Missing 'book'.", 400, origin);

  const MAX_BYTES = 25 * 1024 * 1024; // 25MB — comfortably covers a single NCERT chapter PDF
  if (file.size > MAX_BYTES) {
    return errorResponse("File too large — split into smaller chapter-wise PDFs (under 25MB each).", 400, origin);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Best-effort: keep the original PDF in R2 for audit/re-processing. Never block ingestion on this.
    if (env.SOURCE_PDFS) {
      const key = `${subject}/${chapter}.pdf`;
      env.SOURCE_PDFS.put(key, bytes).catch((err) => console.error("R2 store failed:", err));
    }

    const chunks = await extractAndChunkPdf(bytes);
    if (chunks.length === 0) {
      return errorResponse(
        "No extractable text found in this PDF — it may be a scanned image without a text layer.",
        422,
        origin
      );
    }

    const count = await embedAndUpsertChunks(env, chunks, { subject, chapter, book });

    return jsonResponse({ subject, chapter, book, chunks: count }, { status: 200 }, origin);
  } catch (err) {
    console.error("admin/ingest.ts error:", err);
    return errorResponse("Failed to process this PDF. Check the server logs for details.", 500, origin);
  }
};
