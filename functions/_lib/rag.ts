import type { Env } from "./env";
import type { AskRequest, RetrievedSource } from "../../src/types";
import { buildSystemPrompt, buildUserPrompt, summarizeConversation } from "./prompt";
import { lookupProblemSource, parseProblemReference } from "./exercises";

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768-dim, matches wrangler vectorize create
const TOP_K = 6;
// bge-base is an asymmetric retrieval model: scores against passages run measurably
// lower without this instruction prefix on the query side (passages are embedded plain).
// See BAAI's bge model card. Getting this wrong silently tanks every similarity score.
const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";
const MIN_SCORE = 0.35; // loosened from an earlier over-strict 0.55 that filtered out genuine matches

export async function embedQuery(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBEDDING_MODEL, { text: [QUERY_INSTRUCTION + text] })) as { data: number[][] };
  return result.data[0];
}

export interface RetrievalResult {
  sources: RetrievedSource[];
  insufficientContext: boolean;
  /** True when the student referenced an exercise/example number without picking a chapter first. */
  needsChapter?: boolean;
  /** TEMPORARY diagnostic field — raw top match scores before the MIN_SCORE filter,
   * so we can see real numbers instead of guessing at a threshold. Remove once tuned. */
  debugTopScores?: number[];
}

// When a chapter IS selected but nothing clears MIN_SCORE (typical for numerical
// problems pasted in full — they score low against theory text), still pass the best
// few chunks from THAT chapter: they're on-topic by construction, and the model can
// say so itself if they don't help.
const CHAPTER_FALLBACK_MIN_SCORE = 0.2;
const CHAPTER_FALLBACK_COUNT = 3;
// Vectorize caps topK at 20 when metadata is returned.
const UNFILTERED_FALLBACK_TOPK = 20;

type Match = VectorizeMatches["matches"][number];

function toSource(m: Match): RetrievedSource {
  const meta = (m.metadata ?? {}) as Record<string, string>;
  return {
    id: m.id,
    subject: meta.subjectName ?? meta.subject,
    chapter: meta.chapterName ?? meta.chapter,
    page: meta.page,
    book: meta.book,
    snippet: (meta.snippet ?? "").slice(0, 900),
    score: m.score
  };
}

export async function retrieveContext(
  env: Env,
  question: string,
  filter?: { subject?: string; chapter?: string }
): Promise<RetrievalResult> {
  const vector = await embedQuery(env, question);

  const vectorizeFilter: Record<string, string> = {};
  if (filter?.subject) vectorizeFilter.subject = filter.subject;
  if (filter?.chapter) vectorizeFilter.chapter = filter.chapter;
  const hasFilter = Object.keys(vectorizeFilter).length > 0;

  let matches = (
    await env.VECTORIZE.query(vector, {
      topK: TOP_K,
      returnMetadata: true,
      filter: hasFilter ? vectorizeFilter : undefined
    })
  ).matches;

  // Safety net: Vectorize metadata filters only work on properties that had a metadata
  // index created BEFORE the vectors were inserted. If that index is missing, a filtered
  // query silently returns zero matches. Re-query unfiltered and filter in code instead.
  if (hasFilter && matches.length === 0) {
    console.warn("Filtered Vectorize query returned 0 matches — check metadata indexes. Falling back to in-code filtering.", vectorizeFilter);
    const wide = await env.VECTORIZE.query(vector, { topK: UNFILTERED_FALLBACK_TOPK, returnMetadata: true });
    matches = wide.matches
      .filter((m) => {
        const meta = (m.metadata ?? {}) as Record<string, string>;
        return Object.entries(vectorizeFilter).every(([k, v]) => meta[k] === v);
      })
      .slice(0, TOP_K);
  }

  const debugTopScores = matches.map((m) => Number((m.score ?? 0).toFixed(3)));

  let relevant = matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
  if (relevant.length === 0 && filter?.chapter) {
    relevant = matches.filter((m) => (m.score ?? 0) >= CHAPTER_FALLBACK_MIN_SCORE).slice(0, CHAPTER_FALLBACK_COUNT);
  }

  const sources: RetrievedSource[] = relevant.map(toSource);

  // Exercise / Example number lookup ("solve exercise 2.3", "explain example 2.4").
  let needsChapter = false;
  if (filter?.subject && filter?.chapter) {
    const firstMeta = (matches[0]?.metadata ?? {}) as Record<string, string>;
    const { source } = await lookupProblemSource(env, question, filter.subject, filter.chapter, {
      subjectName: firstMeta.subjectName,
      chapterName: firstMeta.chapterName,
      book: firstMeta.book
    });
    if (source) sources.unshift(source);
  } else if (parseProblemReference(question) && sources.length === 0) {
    needsChapter = true;
  }

  return { sources, insufficientContext: sources.length === 0, needsChapter, debugTopScores };
}

function buildGroqMessages(question: string, sources: RetrievedSource[], mode: AskRequest["mode"], conversation: AskRequest["conversation"]) {
  return [
    { role: "system", content: buildSystemPrompt(mode ?? "explain") },
    { role: "user", content: buildUserPrompt(question, sources, summarizeConversation(conversation)) }
  ];
}

/** Non-streaming generation — used by /api/ask. */
export async function generateAnswer(
  env: Env,
  question: string,
  sources: RetrievedSource[],
  mode: AskRequest["mode"],
  conversation: AskRequest["conversation"]
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error("AI service is not configured.");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: (env.GROQ_MODEL && env.GROQ_MODEL.trim()) || "openai/gpt-oss-120b",
      messages: buildGroqMessages(question, sources, mode, conversation),
      temperature: 0.3,
      max_tokens: 900
    })
  });

    if (!res.ok) {
    // TEMPORARY: surface the real Groq error instead of a generic message, for diagnosis.
    const body = await res.text().catch(() => "");
    throw new Error(`Groq request failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

/** Streaming generation — used by /api/stream. Returns the raw upstream Groq stream Response. */
export async function generateAnswerStream(
  env: Env,
  question: string,
  sources: RetrievedSource[],
  mode: AskRequest["mode"],
  conversation: AskRequest["conversation"]
): Promise<Response> {
  if (!env.GROQ_API_KEY) {
    throw new Error("AI service is not configured.");
  }

  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: (env.GROQ_MODEL && env.GROQ_MODEL.trim()) || "openai/gpt-oss-120b",
      messages: buildGroqMessages(question, sources, mode, conversation),
      temperature: 0.3,
      max_tokens: 900,
      stream: true
    })
  });
}
