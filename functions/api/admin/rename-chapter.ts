import { jsonResponse, errorResponse } from "../../_lib/env";
import { requireAdminKey, type AdminEnv } from "../../_lib/adminAuth";
import { renameAvailableChapter } from "../../_lib/availability";
import { renameChapterVectors } from "../../_lib/ingest";

interface RenameEnv extends AdminEnv {
  SOURCE_PDFS?: R2Bucket;
}

export const onRequestOptions: PagesFunction<RenameEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<RenameEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  const authError = await requireAdminKey(env, request, origin);
  if (authError) return authError;

  let body: { subjectId?: string; chapterId?: string; newTitle?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Expected a JSON body with subjectId, chapterId, and newTitle.", 400, origin);
  }

  const { subjectId, chapterId, newTitle } = body;
  if (typeof subjectId !== "string" || !subjectId.trim() || typeof chapterId !== "string" || !chapterId.trim()) {
    return errorResponse("Missing subjectId or chapterId.", 400, origin);
  }
  if (typeof newTitle !== "string" || !newTitle.trim()) {
    return errorResponse("Missing newTitle.", 400, origin);
  }
  const trimmedTitle = newTitle.trim();

  // Step 1: the dropdown label — this is what actually fixes what students see when
  // picking a chapter, so it happens first and unconditionally.
  const dropdownUpdated = await renameAvailableChapter(env, subjectId, chapterId, trimmedTitle);
  if (!dropdownUpdated) {
    return errorResponse(`No chapter found for subjectId "${subjectId}" / chapterId "${chapterId}".`, 404, origin);
  }

  // Step 2: the source-citation metadata on every chunk. This re-derives vector IDs from
  // the R2-backed original PDF rather than re-embedding, so it's cheap — but it can still
  // fail (PDF missing from R2, Vectorize hiccup). The dropdown fix above already succeeded
  // and stands regardless, so a failure here is reported as a warning, not a 500.
  try {
    const { renamed } = await renameChapterVectors(env, subjectId, chapterId, trimmedTitle);
    return jsonResponse({ chapterTitle: trimmedTitle, chunksRenamed: renamed }, { status: 200 }, origin);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("rename-chapter.ts vector rename error:", err);
    return jsonResponse(
      {
        chapterTitle: trimmedTitle,
        chunksRenamed: 0,
        warning: `Dropdown title updated, but source citations could not be updated: ${detail}`
      },
      { status: 200 },
      origin
    );
  }
};
