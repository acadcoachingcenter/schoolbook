import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse } from "../_lib/env";
import subjectsData from "../../data/subjects.json";

// Bump this whenever data/subjects.json changes so stale KV cache entries
// are never served — a fixed key here previously caused updated curriculum
// data to stay invisible for up to 24h after deploy.
const CACHE_KEY = "subjects:v3";
const CACHE_TTL_SECONDS = 60 * 60; // 1h — short enough that curriculum edits show up promptly

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const origin = request.headers.get("Origin");
  try {
    // Serve from KV cache when available so this cheap, rarely-changing list
    // doesn't get re-read/re-parsed on every navigation click.
    const cached = env.CACHE ? await env.CACHE.get(CACHE_KEY, "json") : null;
    if (cached) return jsonResponse(cached, { status: 200 }, origin);

    if (env.CACHE) {
      await env.CACHE.put(CACHE_KEY, JSON.stringify(subjectsData), { expirationTtl: CACHE_TTL_SECONDS });
    }
    return jsonResponse(subjectsData, { status: 200 }, origin);
  } catch {
    // Cache is best-effort — never fail the request because of it.
    return jsonResponse(subjectsData, { status: 200 }, origin);
  }
};