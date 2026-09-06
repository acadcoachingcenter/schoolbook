import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse, validateQuestion } from "../_lib/env";
import { retrieveContext, generateAnswer } from "../_lib/rag";
import { getRecentHistory, appendTurn, isValidSessionId } from "../_lib/memory";
import type { AskRequest, TutorResponse } from "../../src/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return jsonResponse({}, { status: 204 }, request.headers.get("Origin"));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  let body: AskRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400, origin);
  }

  const validated = validateQuestion(body.question);
  if (!validated.ok) return errorResponse(validated.error, 400, origin);

  const hasSession = isValidSessionId(body.sessionId);
  const history = hasSession ? await getRecentHistory(env, body.sessionId as string) : body.conversation ?? [];

  try {
    const { sources, insufficientContext, debugTopScores } = await retrieveContext(env, validated.value, {
      subject: body.subject,
      chapter: body.chapter
    });

    if (insufficientContext) {
      const response: TutorResponse = {
        answer:
          "I couldn't find enough relevant NCERT material for that question. Try rephrasing it, or pick a subject/chapter from the navigation so I can search more precisely." +
          `\n\n_[Temporary diagnostic — remove once tuned] Top raw scores: ${JSON.stringify(debugTopScores)}_`,
        sources: [],
        mode: body.mode,
        insufficientContext: true
      };
      return jsonResponse(response, { status: 200 }, origin);
    }

    const answer = await generateAnswer(env, validated.value, sources, body.mode, history);

    if (hasSession) {
      await appendTurn(env, body.sessionId as string, validated.value, answer, body.mode, body.subject, body.chapter);
    }

    const response: TutorResponse = { answer, sources, mode: body.mode };
    return jsonResponse(response, { status: 200 }, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The tutor could not complete this response. Try again.";
    // Diagnostic detail stays server-side; the student only sees the safe message.
    console.error("ask.ts error:", err);
    return errorResponse(message, 502, origin);
  }
};
