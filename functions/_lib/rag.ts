import type { Env } from "./env";
import type { AskRequest, RetrievedSource } from "../../src/types";
import { buildSystemPrompt, buildUserPrompt, summarizeConversation } from "./prompt";

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
  /** TEMPORARY diagnostic field — raw top match scores before the MIN_SCORE filter,
   * so we can see real numbers instead of guessing at a threshold. Remove once tuned. */
  debugTopScores?: number[];
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

  const matches = await env.VECTORIZE.query(vector, {
    topK: TOP_K,
    returnMetadata: true,
    filter: Object.keys(vectorizeFilter).length ? vectorizeFilter : undefined
  });

  const debugTopScores = matches.matches.map((m) => Number((m.score ?? 0).toFixed(3)));

  const relevant = matches.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);

  const sources: RetrievedSource[] = relevant.map((m) => {
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
  });

  return { sources, insufficientContext: sources.length === 0, debugTopScores };
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
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
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
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: buildGroqMessages(question, sources, mode, conversation),
      temperature: 0.3,
      max_tokens: 900,
      stream: true
    })
  });
}
