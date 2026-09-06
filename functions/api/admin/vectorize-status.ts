import type { Env } from "../../_lib/env";
import { jsonResponse, errorResponse } from "../../_lib/env";
import { embedQuery } from "../../_lib/rag";

/** TEMPORARY diagnostic endpoint — inspects the Vectorize index directly. Remove once retrieval is confirmed working. */
export const onRequestGet: PagesFunction<Env & { ADMIN_INGEST_KEY?: string }> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const providedKey = request.headers.get("X-Admin-Key");
  if (!env.ADMIN_INGEST_KEY || providedKey !== env.ADMIN_INGEST_KEY) {
    return errorResponse("Unauthorized.", 401, origin);
  }

  const url = new URL(request.url);
  const subject = url.searchParams.get("subject") ?? undefined;
  const chapter = url.searchParams.get("chapter") ?? undefined;

  try {
    const details = await env.VECTORIZE.describe();

    const testVector = await embedQuery(env, "electric charges and fields coulomb law");

    const filter: Record<string, string> = {};
    if (subject) filter.subject = subject;
    if (chapter) filter.chapter = chapter;

    const rawQuery = await env.VECTORIZE.query(testVector, {
      topK: 5,
      returnMetadata: true,
      filter: Object.keys(filter).length ? filter : undefined
    });

    // Also grab a handful of vectors with NO filter, purely to see what metadata
    // actually looks like right now (exact key names/values), regardless of the filter test above.
    const unfilteredSample = await env.VECTORIZE.query(testVector, { topK: 3, returnMetadata: true });

    return jsonResponse(
      {
        indexDescribe: details,
        appliedFilter: Object.keys(filter).length ? filter : "none",
        filteredMatchCount: rawQuery.matches.length,
        filteredMatches: rawQuery.matches.map((m) => ({ id: m.id, score: m.score, metadata: m.metadata })),
        unfilteredSampleMetadata: unfilteredSample.matches.map((m) => ({ id: m.id, metadata: m.metadata }))
      },
      { status: 200 },
      origin
    );
  } catch (err) {
    return errorResponse(`Diagnostic failed: ${err instanceof Error ? err.message : String(err)}`, 500, origin);
  }
};