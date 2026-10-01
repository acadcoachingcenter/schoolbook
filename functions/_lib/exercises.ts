import type { Env } from "./env";
import type { RetrievedSource } from "../../src/types";
import { extractPdfPages } from "./ingest";

/**
 * Exercise / Example lookup for NCERT chapters.
 *
 * Why this exists: semantic search (bge embeddings) cannot match a question like
 * "solve exercise 2.3" or "explain example 2.4" — the student's text contains only
 * a number, and the embedding of a number carries no meaning. So those questions
 * scored below MIN_SCORE and the tutor replied "couldn't find enough relevant NCERT
 * material" even though the chapter was ingested.
 *
 * This module parses the chapter's own text into numbered exercise items and worked
 * examples, caches the result in KV, and returns the exact problem statement as a
 * source so the tutor can solve it.
 */

const CACHE_PREFIX = "exercises:v1";
const ITEM_MAX_CHARS = 1800;
const EXAMPLE_MAX_CHARS = 2600;

export interface ExerciseItem {
  /** Item number as printed, e.g. "2.3" (Physics/Chemistry) or "4" (Maths/Biology). */
  num: string;
  /** Maths-style exercise set this item belongs to, e.g. "2.1" for "EXERCISE 2.1". */
  set?: string;
  page: number;
  text: string;
}

export interface ExampleItem {
  num: string;
  page: number;
  text: string;
}

export interface ChapterExercises {
  items: ExerciseItem[];
  examples: ExampleItem[];
}

export interface ProblemReference {
  kind: "exercise" | "example";
  num: string;
  set?: string;
}

const stripFooter = (text: string) => text.replace(/Reprint\s*\d{4}-\d{2,4}/gi, "");

interface Line {
  page: number;
  text: string;
}

function toLines(pages: string[]): Line[] {
  const out: Line[] = [];
  pages.forEach((p, i) => {
    for (const raw of stripFooter(p ?? "").split(/\r?\n/)) {
      const text = raw.replace(/\s+/g, " ").trim();
      if (text) out.push({ page: i + 1, text });
    }
  });
  return out;
}

// "EXERCISES", "Exercises", "ADDITIONAL EXERCISES", "EXERCISE 2.1"
const EXERCISE_HEADING = /^(additional\s+)?exercises?\b\s*(\d{1,2}\.\d{1,2})?\s*$/i;
// "2.3 Two charges ..." (dotted numbering — Physics/Chemistry)
const DOTTED_ITEM = /^(\d{1,2}\.\d{1,2})\s+(?=[A-Z(“"'])/;
// "4. Find the ..." / "4) ..." (plain numbering — Maths/Biology)
const PLAIN_ITEM = /^(\d{1,2})[.)]\s+(?=\S)/;
// "Example 2.4" / "Example 4"
const EXAMPLE_HEADING = /^example\s+(\d{1,2}(?:\.\d{1,2})?)\b/i;

/** Parses exercise items and worked examples out of a chapter's per-page text. */
export function parseChapterExercises(pages: string[]): ChapterExercises {
  const lines = toLines(pages);

  // ---------- Worked examples (anywhere in the chapter) ----------
  const examples: ExampleItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(EXAMPLE_HEADING);
    if (!m) continue;
    const num = m[1];
    if (examples.some((e) => e.num === num)) continue; // keep first occurrence only
    let text = lines[i].text;
    for (let j = i + 1; j < lines.length && text.length < EXAMPLE_MAX_CHARS; j++) {
      if (EXAMPLE_HEADING.test(lines[j].text) || EXERCISE_HEADING.test(lines[j].text)) break;
      text += " " + lines[j].text;
    }
    examples.push({ num, page: lines[i].page, text: text.slice(0, EXAMPLE_MAX_CHARS) });
  }

  // ---------- Exercise items ----------
  const items: ExerciseItem[] = [];
  const startIdx = lines.findIndex((l) => EXERCISE_HEADING.test(l.text));
  if (startIdx !== -1) {
    let currentSet: string | undefined;
    let current: ExerciseItem | null = null;

    const flush = () => {
      if (current && current.text.length > 3) {
        current.text = current.text.slice(0, ITEM_MAX_CHARS);
        const dup = items.some((it) => it.num === current!.num && it.set === current!.set);
        if (!dup) items.push(current);
      }
      current = null;
    };

    for (let i = startIdx; i < lines.length; i++) {
      const { text, page } = lines[i];

      const heading = text.match(EXERCISE_HEADING);
      if (heading) {
        flush();
        if (heading[2]) currentSet = heading[2];
        continue;
      }

      // Maths chapters interleave exercise sets with theory and worked examples —
      // stop appending to the previous item once an example starts.
      if (EXAMPLE_HEADING.test(text)) {
        flush();
        continue;
      }

      const dotted = text.match(DOTTED_ITEM);
      const plain = !dotted ? text.match(PLAIN_ITEM) : null;
      const itemMatch = dotted ?? plain;

      if (itemMatch) {
        flush();
        current = { num: itemMatch[1], set: dotted ? undefined : currentSet, page, text };
        continue;
      }

      if (current) current.text += " " + text;
    }
    flush();
  }

  return { items, examples };
}

/** Detects "exercise 2.3", "Q 5", "question no. 4", "Ex 2.1 Q3", "example 2.4" etc. */
export function parseProblemReference(question: string): ProblemReference | null {
  const q = question.toLowerCase();

  const example = q.match(/\b(?:example|eg\.?|e\.g\.)\s*(?:no\.?|number|#)?\s*(\d{1,2}(?:\.\d{1,2})?)\b/);
  if (example) return { kind: "example", num: example[1] };

  // Maths style: "exercise 2.1 question 4", "ex 2.1 q4", "ex. 2.1, 4"
  const setAndNum = q.match(
    /\b(?:exercise|ex)\.?\s*(\d{1,2}\.\d{1,2})\s*[,\-–:]?\s*(?:q(?:uestion|n|ue)?\.?|problem|no\.?|number|#)\s*(\d{1,2})\b/
  );
  if (setAndNum) return { kind: "exercise", set: setAndNum[1], num: setAndNum[2] };

  const single = q.match(
    /\b(?:exercises?|ex|q(?:uestion|n|ue)?|problem|sum)\.?\s*(?:no\.?|number|#)?\s*(\d{1,2}(?:\.\d{1,2})?)\b/
  );
  if (single) return { kind: "exercise", num: single[1] };

  return null;
}

function findItem(data: ChapterExercises, ref: ProblemReference): ExerciseItem | ExampleItem | null {
  if (ref.kind === "example") {
    return (
      data.examples.find((e) => e.num === ref.num) ??
      // "example 4" in a chapter that numbers examples "2.4"
      data.examples.find((e) => e.num.endsWith(`.${ref.num}`)) ??
      null
    );
  }

  if (ref.set) {
    const inSet = data.items.find((it) => it.set === ref.set && it.num === ref.num);
    if (inSet) return inSet;
  }

  const exact = data.items.find((it) => it.num === ref.num && !ref.set);
  if (exact) return exact;

  // Student typed "question 5" in a Physics chapter whose items are "2.5":
  // infer the chapter prefix from the parsed items.
  if (!ref.num.includes(".")) {
    const dottedPrefix = data.items.find((it) => it.num.includes("."))?.num.split(".")[0];
    if (dottedPrefix) {
      const inferred = data.items.find((it) => it.num === `${dottedPrefix}.${ref.num}`);
      if (inferred) return inferred;
    }
  }

  // Exercise number given as "2.3" but the chapter uses plain numbering under "EXERCISE 2" sets — last resort.
  return data.items.find((it) => it.num === ref.num) ?? null;
}

function cacheKey(subjectId: string, chapterId: string) {
  return `${CACHE_PREFIX}:${subjectId}:${chapterId}`;
}

/** Stores parsed exercises for a chapter — called at ingest time (best-effort). */
export async function cacheChapterExercises(
  env: Env,
  subjectId: string,
  chapterId: string,
  data: ChapterExercises
): Promise<void> {
  if (!env.CACHE) return;
  try {
    await env.CACHE.put(cacheKey(subjectId, chapterId), JSON.stringify(data));
  } catch (err) {
    console.error("cacheChapterExercises failed:", err);
  }
}

/**
 * Loads parsed exercises for a chapter: KV cache first; otherwise re-derives them from
 * the chapter's original PDF in R2 (so chapters ingested before this feature still work
 * without a re-upload) and caches the result for next time.
 */
export async function loadChapterExercises(
  env: Env,
  subjectId: string,
  chapterId: string
): Promise<ChapterExercises | null> {
  if (env.CACHE) {
    try {
      const cached = (await env.CACHE.get(cacheKey(subjectId, chapterId), "json")) as ChapterExercises | null;
      if (cached && Array.isArray(cached.items)) return cached;
    } catch (err) {
      console.warn("exercise cache read failed:", err);
    }
  }

  if (!env.SOURCE_PDFS) return null;
  const object = await env.SOURCE_PDFS.get(`${subjectId}/${chapterId}.pdf`);
  if (!object) {
    console.warn(`Exercise lookup: no source PDF in R2 at ${subjectId}/${chapterId}.pdf — re-upload the chapter.`);
    return null;
  }

  const pages = await extractPdfPages(new Uint8Array(await object.arrayBuffer()));
  const data = parseChapterExercises(pages);
  await cacheChapterExercises(env, subjectId, chapterId, data);
  return data;
}

/**
 * Resolves a question like "exercise 2.3" to the exact NCERT problem text, returned
 * as a RetrievedSource so it flows through the existing prompt + source-card pipeline.
 */
export async function lookupProblemSource(
  env: Env,
  question: string,
  subjectId: string,
  chapterId: string,
  labels: { subjectName?: string; chapterName?: string; book?: string } = {}
): Promise<{ ref: ProblemReference | null; source: RetrievedSource | null }> {
  const ref = parseProblemReference(question);
  if (!ref) return { ref: null, source: null };

  let data: ChapterExercises | null = null;
  try {
    data = await loadChapterExercises(env, subjectId, chapterId);
  } catch (err) {
    console.error("loadChapterExercises failed:", err);
  }
  if (!data) return { ref, source: null };

  const hit = findItem(data, ref);
  if (!hit) return { ref, source: null };

  const label =
    ref.kind === "example"
      ? `NCERT Example ${hit.num}`
      : `NCERT Exercise ${"set" in hit && hit.set ? `${hit.set}, Q${hit.num}` : hit.num}`;

  return {
    ref,
    source: {
      id: `${subjectId}-${chapterId}-${ref.kind}-${hit.num}${"set" in hit && hit.set ? `-set${hit.set}` : ""}`,
      subject: labels.subjectName ?? subjectId,
      chapter: labels.chapterName ?? chapterId,
      page: String(hit.page),
      book: labels.book,
      snippet: `${label} (problem statement as printed in NCERT):\n${hit.text}`,
      score: 1
    }
  };
}
