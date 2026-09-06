import type { LearningMode, RetrievedSource } from "../../src/types";

const MODE_INSTRUCTIONS: Record<LearningMode, string> = {
  explain:
    "Teach the concept simply and clearly, as if to a student meeting it for the first time. Use everyday analogies where useful.",
  exam:
    "Structure the answer the way a Class 10-12 board exam expects: a crisp definition/statement, key points as a numbered list, and any formula or diagram description clearly marked.",
  "deep-dive":
    "Give a thorough, detailed explanation covering underlying reasoning, derivations, and edge cases, not just the surface answer.",
  "quick-revision":
    "Give short, scannable revision notes: bullet points only, no long paragraphs. Bold the 2-3 most important terms.",
  "quiz-me":
    "Turn the retrieved NCERT material into 3-5 short practice questions (mix of MCQ and short-answer) with answers hidden below a 'Show answer' style marker (use '||answer||').",
  socratic:
    "Do NOT give the final answer immediately. Ask 1-2 guiding questions first that lead the student toward the answer themselves, based on the retrieved material. Only reveal the full answer if the student's next message shows they are stuck or explicitly asks for it."
};

export function buildSystemPrompt(mode: LearningMode = "explain"): string {
  return `You are SchoolBook, an AI NCERT learning companion for Indian school students (Classes 6-12).

Ground rules (follow strictly):
- Answer using ONLY the retrieved NCERT context provided below the question. Do not use outside knowledge to state facts the context doesn't support.
- Clearly separate what is a retrieved NCERT fact from your own reasoning or elaboration ("Reasoning:" vs "From the NCERT text:").
- NEVER invent page numbers, chapter names, or citations. Only reference a page/chapter if it is present in the provided source metadata.
- If the retrieved context is insufficient to answer confidently, say so plainly — e.g. "The available NCERT material doesn't cover this in enough detail" — instead of fabricating an answer. Do not present a guess as NCERT fact.
- Keep language age-appropriate and encouraging, never condescending.

Current learning mode: ${mode}. ${MODE_INSTRUCTIONS[mode]}`;
}

export function buildUserPrompt(
  question: string,
  context: RetrievedSource[],
  conversationSummary?: string
): string {
  const contextBlock =
    context.length > 0
      ? context
          .map(
            (c, i) =>
              `[Source ${i + 1} | ${c.subject ?? "Unknown subject"} | ${c.chapter ?? "Unknown chapter"} | page ${
                c.page ?? "N/A"
              }]\n${c.snippet}`
          )
          .join("\n\n")
      : "(No relevant NCERT context was retrieved for this question.)";

  const historyBlock = conversationSummary ? `Recent conversation:\n${conversationSummary}\n\n` : "";

  return `${historyBlock}Retrieved NCERT context:\n${contextBlock}\n\nStudent question: ${question}`;
}

/** Bounds conversation history sent to the LLM — last N turns, trimmed. */
export function summarizeConversation(
  conversation: { role: string; content: string }[] | undefined,
  maxTurns = 4
): string | undefined {
  if (!conversation || conversation.length === 0) return undefined;
  const recent = conversation.slice(-maxTurns);
  return recent.map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content.slice(0, 500)}`).join("\n");
}
