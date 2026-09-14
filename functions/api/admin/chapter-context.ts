import type { Env } from "../../_lib/env";
import { jsonResponse, errorResponse } from "../../_lib/env";
import { requireAdminKey, type AdminEnv } from "../../_lib/adminAuth";
import { embedQuery } from "../../_lib/rag";

// A single NCERT chapter chunked at 1200 chars/chunk (see ingest.ts) runs to
// roughly 20-40 chunks. Pulling up to this many, then trimming by character
// budget below, gives GradeMe's question generator a genuinely broad spread
// of the chapter rather than just a few top-scoring passages.
const MAX_CHUNKS = 40;
const MAX_CONTEXT_CHARS = 14000;

export const onRequestOptions: PagesFunction<AdminEnv> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

/**
 * GET /api/admin/chapter-context?subject=<subjectId>&chapter=<chapterId>
 * Header: X-Admin-Key: <ADMIN_INGEST_KEY>  (same key already used for /api/admin/ingest)
 *
 * Returns a broad sample of a chapter's ingested NCERT text, restored to page
 * order so it reads coherently. Server-to-server only (GradeMe's acad-api
 * Worker calls this) -- never exposed to the browser, which is why it reuses
 * the existing admin-key gate rather than student session auth.
 */
export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  const authError = await requireAdminKey(env, request, origin);
  if (authError) return authError;

  const url = new URL(request.url);
  const subject = url.searchParams.get("subject");
  const chapter = url.searchParams.get("chapter");

  if (!subject || !chapter) {
    return errorResponse("Missing required 'subject' and 'chapter' query parameters.", 400, origin);
  }

  // There's no real student question here -- we want a representative sample
  // of the chapter's own content, not an answer to one narrow ask. Embedding
  // the chapter id itself as a generic query, combined with the exact
  // subject/chapter metadata filter, is enough: the filter does the real
  // work of scoping to this chapter, the query vector just orders the
  // candidates Vectorize returns.
  const vector = await embedQuery(env, chapter.replace(/-/g, " "));

  const matches = await env.VECTORIZE.query(vector, {
    topK: MAX_CHUNKS,
    returnMetadata: true,
    filter: { subject, chapter }
  });

  if (matches.matches.length === 0) {
    return jsonResponse(
      {
        chunkCount: 0,
        context: "",
        note: "No ingested content found for this subject/chapter yet -- upload the chapter PDF via /api/admin/ingest first."
      },
      { status: 200 },
      origin
    );
  }

  // Matches come back ranked by similarity to the query, not by page --
  // restore page order so the combined context reads top-to-bottom the way
  // the chapter itself is laid out, which makes for better question coverage
  // than a shuffled bag of the highest-scoring snippets.
  const chunks = matches.matches
    .map((m) => {
      const meta = (m.metadata ?? {}) as Record<string, string>;
      return { page: Number(meta.page) || 0, snippet: (meta.snippet ?? "").slice(0, 900) };
    })
    .sort((a, b) => a.page - b.page);

  let context = "";
  for (const c of chunks) {
    if (context.length + c.snippet.length > MAX_CONTEXT_CHARS) break;
    context += `\n\n[Page ${c.page}]\n${c.snippet}`;
  }

  return jsonResponse(
    { chunkCount: chunks.length, context: context.trim() },
    { status: 200 },
    origin
  );
};
