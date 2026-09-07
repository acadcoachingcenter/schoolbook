import type { Env } from "../../_lib/env";
import { jsonResponse, errorResponse } from "../../_lib/env";
import { extractPdfPages, chunkPages, embedAndUpsertChunks, slug } from "../../_lib/ingest";
import { detectChapterInfo } from "../../_lib/detect";
import { upsertAvailableChapter } from "../../_lib/availability";

interface IngestEnv extends Env {
  ADMIN_INGEST_KEY: string;
  SOURCE_PDFS?: R2Bucket;
}

const MAX_ATTEMPTS = 8;
const LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes

/**
 * Simple KV-backed rate limiter, keyed by client IP. This is what makes a short,
 * memorable admin PIN safe to use: even a 6-digit PIN (1,000,000 combinations)
 * takes an impractical number of 15-minute windows to brute-force at 8 attempts
 * per window, versus being guessable in seconds with no limiter at all.
 * Not perfectly atomic (KV read-then-write has a small race window), but that's
 * an acceptable trade-off for slowing down automated guessing, not a hard barrier.
 */
async function checkAndRecordAttempt(env: IngestEnv, ip: string): Promise<boolean> {
  if (!env.CACHE) return true; // fail open if KV isn't available — ingestion still gated by the key itself
  const key = `admin-attempts:${ip}`;
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= MAX_ATTEMPTS) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: LOCKOUT_WINDOW_SECONDS });
  return true;
}

async function clearAttempts(env: IngestEnv, ip: string): Promise<void> {
  if (!env.CACHE) return;
  await env.CACHE.delete(`admin-attempts:${ip}`).catch(() => {});
}

export const onRequestOptions: PagesFunction<IngestEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<IngestEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  if (!env.ADMIN_INGEST_KEY) {
    return errorResponse("Ingestion is not configured on this deployment.", 503, origin);
  }

  const allowed = await checkAndRecordAttempt(env, ip);
  if (!allowed) {
    return errorResponse("Too many attempts. Try again in 15 minutes.", 429, origin);
  }

  const providedKey = request.headers.get("X-Admin-Key");
  if (!providedKey || providedKey !== env.ADMIN_INGEST_KEY) {
    return errorResponse("Unauthorized.", 401, origin);
  }

  // Correct key — this request's attempt shouldn't count against the limit for next time.
  await clearAttempts(env, ip);

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
