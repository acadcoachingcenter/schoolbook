import type { Env } from "./env";
import type { AskRequest, RetrievedSource } from "../../src/types";
import { buildSystemPrompt, buildUserPrompt, summarizeConversation } from "./prompt";

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768-dim, matches wrangler vectorize create
const TOP_K = 6;
const MIN_SCORE = 0.55; // below this we treat retrieval as "not found" rather than force-feeding weak matches

export async function embedQuery(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBEDDING_MODEL, { text: [text] })) as { data: number[][] };
  return result.data[0];
}

export interface RetrievalResult {
  sources: RetrievedSource[];
  insufficientContext: boolean;
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

  const relevant = matches.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);

  const sources: RetrievedSource[] = relevant.map((m) => {
    const meta = (m.metadata ?? {}) as Record<string, string>;
    return {
      id: m.id,
      subject: meta.subject,
      chapter: meta.chapter,
      page: meta.page,
      book: meta.book,
      snippet: (meta.snippet ?? "").slice(0, 900),
      score: m.score
    };
  });

  return { sources, insufficientContext: sources.length === 0 };
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
      model: env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages: buildGroqMessages(question, sources, mode, conversation),
      temperature: 0.3,
      max_tokens: 900
    })
  });

  if (!res.ok) {
    throw new Error("The tutor could not complete this response. Try again.");
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
      model: env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages: buildGroqMessages(question, sources, mode, conversation),
      temperature: 0.3,
      max_tokens: 900,
      stream: true
    })
  });
}
