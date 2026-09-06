import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse } from "../_lib/env";
import { getFullHistory, isValidSessionId } from "../_lib/memory";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!isValidSessionId(sessionId)) {
    return errorResponse("Missing or invalid 'sessionId' query parameter.", 400, origin);
  }

  const history = await getFullHistory(env, sessionId);
  return jsonResponse({ messages: history }, { status: 200 }, origin);
};
