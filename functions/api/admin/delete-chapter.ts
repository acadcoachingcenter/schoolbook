import { jsonResponse, errorResponse } from "../../_lib/env";
import { requireAdminKey, type AdminEnv } from "../../_lib/adminAuth";
import { deleteAvailableChapter } from "../../_lib/availability";
import { deleteChapterVectors } from "../../_lib/ingest";

interface DeleteEnv extends AdminEnv {
  SOURCE_PDFS?: R2Bucket;
}

export const onRequestOptions: PagesFunction<DeleteEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<DeleteEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  const authError = await requireAdminKey(env, request, origin);
  if (authError) return authError;

  let body: { subjectId?: string; chapterId?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Expected a JSON body with subjectId and chapterId.", 400, origin);
  }

  const { subjectId, chapterId } = body;
  if (typeof subjectId !== "string" || !subjectId.trim() || typeof chapterId !== "string" || !chapterId.trim()) {
    return errorResponse("Missing subjectId or chapterId.", 400, origin);
  }

  // Step 1: the dropdown entry — this is what actually stops students from seeing the
  // wrong chapter, so it happens first and unconditionally. If nothing matches, treat
  // this as a genuine "not found" rather than continuing to poke at Vectorize/R2.
  const removedFromRegistry = await deleteAvailableChapter(env, subjectId, chapterId);
  if (!removedFromRegistry) {
    return errorResponse(`No chapter found for subjectId "${subjectId}" / chapterId "${chapterId}".`, 404, origin);
  }

  // Step 2: the underlying vectors, so deleted content can't still surface in answers.
  // The registry entry is already gone regardless of how this goes, so failures here
  // come back as a warning, not a 500.
  let deleted = 0;
  let warning: string | undefined;
  try {
    const result = await deleteChapterVectors(env, subjectId, chapterId);
    deleted = result.deleted;
    if (!result.complete) {
      warning = `Removed ${deleted} chunks, but there may be more left in Vectorize than the lookup could find in one pass — check the Cloudflare dashboard for stragglers under subject "${subjectId}" / chapter "${chapterId}".`;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("delete-chapter.ts vector delete error:", err);
    warning = `Chapter removed from the student list, but its indexed content could not be fully deleted: ${detail}`;
  }

  // Step 3: best-effort cleanup of the R2 PDF backup — never block the response on this.
  if (env.SOURCE_PDFS) {
    env.SOURCE_PDFS.delete(`${subjectId}/${chapterId}.pdf`).catch((err) =>
      console.error("delete-chapter.ts R2 cleanup failed:", err)
    );
  }

  return jsonResponse({ deleted, warning }, { status: 200 }, origin);
};
