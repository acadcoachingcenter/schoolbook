import type { Env } from "./env";
import { errorResponse } from "./env";

export interface AdminEnv extends Env {
  ADMIN_INGEST_KEY: string;
}

const MAX_ATTEMPTS = 8;
const LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes

/**
 * Simple KV-backed rate limiter, keyed by client IP. This is what makes a short,
 * memorable admin PIN safe to use: even a 6-digit PIN (1,000,000 combinations)
 * takes an impractical number of 15-minute windows to brute-force at 8 attempts
 * per window, versus being guessable in seconds with no limiter at all.
 * Not perfectly atomic (KV read-then-write has a small race window), but that's
 * an acceptable trade-off for slowing down automated guessing, not a hard barrier.
 */
async function checkAndRecordAttempt(env: AdminEnv, ip: string): Promise<boolean> {
  if (!env.CACHE) return true; // fail open if KV isn't available — still gated by the key itself
  const key = `admin-attempts:${ip}`;
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= MAX_ATTEMPTS) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: LOCKOUT_WINDOW_SECONDS });
  return true;
}

async function clearAttempts(env: AdminEnv, ip: string): Promise<void> {
  if (!env.CACHE) return;
  await env.CACHE.delete(`admin-attempts:${ip}`).catch(() => {});
}

/**
 * Verifies the shared admin key on a request, with IP-based rate limiting on failed
 * attempts. Shared by every /api/admin/* route so the same brute-force protection
 * covers ingest, rename, and any future admin action, instead of each route
 * re-implementing (and potentially drifting from) its own copy.
 *
 * Returns null when the request is authorized to proceed. Otherwise returns the
 * Response that should be sent back immediately — callers just do:
 *   const authError = await requireAdminKey(env, request, origin);
 *   if (authError) return authError;
 */
export async function requireAdminKey(env: AdminEnv, request: Request, origin: string | null): Promise<Response | null> {
  if (!env.ADMIN_INGEST_KEY) {
    return errorResponse("Admin actions are not configured on this deployment.", 503, origin);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const allowed = await checkAndRecordAttempt(env, ip);
  if (!allowed) {
    return errorResponse("Too many attempts. Try again in 15 minutes.", 429, origin);
  }

  const providedKey = request.headers.get("X-Admin-Key");
  if (!providedKey || providedKey !== env.ADMIN_INGEST_KEY) {
    return errorResponse("Unauthorized.", 401, origin);
  }

  // Correct key — this request's attempt shouldn't count against the limit for next time.
  await clearAttempts(env, ip);
  return null;
}
