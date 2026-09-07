import type { Env } from "../_lib/env";
import { jsonResponse } from "../_lib/env";
import { getAvailableChapters } from "../_lib/availability";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const available = await getAvailableChapters(env);
  return jsonResponse({ available }, { status: 200 }, origin);
};