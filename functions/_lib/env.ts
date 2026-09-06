// Cloudflare Pages Functions env — matches the bindings declared in wrangler.toml
export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
  CACHE: KVNamespace;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
}

export const MAX_QUESTION_LENGTH = 1200;

export function corsHeaders(origin: string | null): HeadersInit {
  // Same-origin app (frontend and API are the same Pages project), but keep this
  // explicit and restrictive rather than a wildcard, since it's easy to widen later.
  const allowed = origin && (origin.endsWith(".acadapp.in") || origin.includes("localhost")) ? origin : "https://schoolbooks.acadapp.in";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
      ...(init.headers ?? {})
    }
  });
}

export function errorResponse(message: string, status = 400, origin: string | null = null): Response {
  return jsonResponse({ error: message }, { status }, origin);
}

/** Basic input validation + sanitization for the incoming question. */
export function validateQuestion(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "'question' must be a string." };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "Please enter a question." };
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` };
  }
  // Strip control characters; do not attempt to "fix" prompt-injection phrasing here —
  // that's handled by keeping the system prompt authoritative in rag.ts, not by string surgery.
  // eslint-disable-next-line no-control-regex
  const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return { ok: true, value: sanitized };
}
