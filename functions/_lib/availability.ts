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

/**
 * Updates just the display title (chapterTitle) shown in the student-facing Chapter
 * Explorer dropdown for an already-ingested chapter — subjectId, chapterId, and
 * everything else about the entry stay exactly as they were. Returns false if no
 * matching (subjectId, chapterId) entry exists yet.
 */
export async function renameAvailableChapter(
  env: Env,
  subjectId: string,
  chapterId: string,
  newTitle: string
): Promise<boolean> {
  if (!env.CACHE) return false;
  try {
    const current = await getAvailableChapters(env);
    const idx = current.findIndex((c) => c.subjectId === subjectId && c.chapterId === chapterId);
    if (idx < 0) return false;
    current[idx] = { ...current[idx], chapterTitle: newTitle };
    await env.CACHE.put(REGISTRY_KEY, JSON.stringify(current));
    return true;
  } catch (err) {
    console.error("renameAvailableChapter failed:", err);
    return false;
  }
}

/**
 * Removes a chapter's entry entirely — used to clean up bad/junk entries (e.g. a
 * stale "untitled" chapter left over from a past ingest bug) so it stops appearing
 * in the student-facing Chapter Explorer. Returns false if no matching entry existed.
 */
export async function deleteAvailableChapter(env: Env, subjectId: string, chapterId: string): Promise<boolean> {
  if (!env.CACHE) return false;
  try {
    const current = await getAvailableChapters(env);
    const next = current.filter((c) => !(c.subjectId === subjectId && c.chapterId === chapterId));
    if (next.length === current.length) return false; // nothing matched
    await env.CACHE.put(REGISTRY_KEY, JSON.stringify(next));
    return true;
  } catch (err) {
    console.error("deleteAvailableChapter failed:", err);
    return false;
  }
}
