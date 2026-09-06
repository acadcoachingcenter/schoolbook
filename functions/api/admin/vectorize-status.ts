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

  try {
    const details = await env.VECTORIZE.describe();

    const testVector = await embedQuery(env, "electric charges and fields coulomb law");
    const rawQuery = await env.VECTORIZE.query(testVector, { topK: 5, returnMetadata: true });

    return jsonResponse(
      {
        indexDescribe: details,
        testQueryVectorLength: testVector.length,
        testQueryMatchCount: rawQuery.matches.length,
        testQueryMatches: rawQuery.matches.map((m) => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata
        }))
      },
      { status: 200 },
      origin
    );
  } catch (err) {
    return errorResponse(`Diagnostic failed: ${err instanceof Error ? err.message : String(err)}`, 500, origin);
  }
};