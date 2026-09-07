import type { Env } from "./env";

const REGISTRY_KEY = "available-chapters:v2";

export interface AvailableChapter {
  subjectId: string;
  chapterId: string;
  className: string;
  subjectName: string;
  chapterTitle: string;
  book: string;
  subtopics: string[];
}

export async function getAvailableChapters(env: Env): Promise<AvailableChapter[]> {
  if (!env.CACHE) return [];
  try {
    const raw = await env.CACHE.get(REGISTRY_KEY, "json");
    return Array.isArray(raw) ? (raw as AvailableChapter[]) : [];
  } catch (err) {
    console.error("getAvailableChapters failed:", err);
    return [];
  }
}

/** Records or updates a chapter's entry — called after a successful admin ingest. */
export async function upsertAvailableChapter(env: Env, entry: AvailableChapter): Promise<void> {
  if (!env.CACHE) return;
  try {
    const current = await getAvailableChapters(env);
    const idx = current.findIndex((c) => c.subjectId === entry.subjectId && c.chapterId === entry.chapterId);
    if (idx >= 0) current[idx] = entry;
    else current.push(entry);
    await env.CACHE.put(REGISTRY_KEY, JSON.stringify(current));
  } catch (err) {
    // Best-effort — never fail the ingest response over registry bookkeeping.
    console.error("upsertAvailableChapter failed:", err);
  }
}
