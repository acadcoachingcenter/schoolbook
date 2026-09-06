import type { Env } from "../_lib/env";
import { jsonResponse } from "../_lib/env";
import type { HealthResponse } from "../../src/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const origin = request.headers.get("Origin");
  const ragConfigured = Boolean(env.GROQ_API_KEY) && Boolean(env.VECTORIZE);

  const body: HealthResponse = {
    status: ragConfigured ? "ok" : "degraded",
    service: "schoolbook-ncert-tutor",
    rag: ragConfigured
  };

  return jsonResponse(body, { status: 200 }, origin);
};
