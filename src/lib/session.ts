const STORAGE_KEY = "schoolbook:sessionId";

/**
 * A per-browser, anonymous session id. Not an auth token — just a bucket
 * key so /api/conversation can restore recent history after a refresh.
 * Safe to clear any time (e.g. "New conversation" action).
 */
export function getSessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const fresh = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable (private browsing, etc.) — fall back to an in-memory id
    // for this page load only; history just won't survive a refresh in that case.
    return crypto.randomUUID();
  }
}

export function resetSessionId(): string {
  const fresh = crypto.randomUUID();
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // ignore — see getSessionId
  }
  return fresh;
}
