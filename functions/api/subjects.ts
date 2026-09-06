import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse } from "../_lib/env";
import subjectsData from "../../data/subjects.json";

const CACHE_KEY = "subjects:v1";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const origin = request.headers.get("Origin");
  try {
    // Serve from KV cache when available so this cheap, rarely-changing list
    // doesn't get re-read/re-parsed on every navigation click.
    const cached = env.CACHE ? await env.CACHE.get(CACHE_KEY, "json") : null;
    if (cached) return jsonResponse(cached, { status: 200 }, origin);

    if (env.CACHE) {
      await env.CACHE.put(CACHE_KEY, JSON.stringify(subjectsData), { expirationTtl: 60 * 60 * 24 });
    }
    return jsonResponse(subjectsData, { status: 200 }, origin);
  } catch {
    // Cache is best-effort — never fail the request because of it.
    return jsonResponse(subjectsData, { status: 200 }, origin);
  }
};
