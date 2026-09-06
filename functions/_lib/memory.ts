import type { Env } from "./env";
import type { ConversationMessage, LearningMode } from "../../src/types";

const MAX_TURNS_RETURNED = 6; // "bounded conversation window" per spec — last 6 messages, not full history
const MAX_SESSION_ID_LENGTH = 128;

/** A session id is a client-generated opaque string (see src/lib/session.ts) — validate shape only. */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_SESSION_ID_LENGTH && /^[a-zA-Z0-9-]+$/.test(id);
}

export async function getRecentHistory(env: Env, sessionId: string): Promise<ConversationMessage[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT role, content FROM conversation_messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(sessionId, MAX_TURNS_RETURNED)
      .all<{ role: "user" | "assistant"; content: string }>();

    return (results ?? []).reverse();
  } catch (err) {
    // Memory is a nice-to-have, not a hard dependency — never fail the tutor over it.
    console.error("getRecentHistory failed:", err);
    return [];
  }
}

export async function getFullHistory(env: Env, sessionId: string, limit = 40): Promise<ConversationMessage[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT role, content FROM conversation_messages
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
      .bind(sessionId, limit)
      .all<{ role: "user" | "assistant"; content: string }>();
    return results ?? [];
  } catch (err) {
    console.error("getFullHistory failed:", err);
    return [];
  }
}

export async function appendTurn(
  env: Env,
  sessionId: string,
  question: string,
  answer: string,
  mode?: LearningMode,
  subject?: string,
  chapter?: string
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO conversation_messages (session_id, role, content, mode, subject, chapter) VALUES (?, 'user', ?, ?, ?, ?)`
      ).bind(sessionId, question, mode ?? null, subject ?? null, chapter ?? null),
      env.DB.prepare(
        `INSERT INTO conversation_messages (session_id, role, content, mode, subject, chapter) VALUES (?, 'assistant', ?, ?, ?, ?)`
      ).bind(sessionId, answer, mode ?? null, subject ?? null, chapter ?? null)
    ]);
  } catch (err) {
    // Same reasoning — log and move on, don't break the response the student already got.
    console.error("appendTurn failed:", err);
  }
}
