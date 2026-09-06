import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse, validateQuestion, corsHeaders } from "../_lib/env";
import { retrieveContext, generateAnswerStream } from "../_lib/rag";
import type { AskRequest } from "../../src/types";

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

  let sources, insufficientContext;
  try {
    ({ sources, insufficientContext } = await retrieveContext(env, validated.value, {
      subject: body.subject,
      chapter: body.chapter
    }));
  } catch (err) {
    console.error("stream.ts retrieval error:", err);
    return errorResponse("NCERT search is temporarily unavailable.", 502, origin);
  }

  const encoder = new TextEncoder();

  if (insufficientContext) {
    const stream = new ReadableStream({
      start(controller) {
        const msg =
          "I couldn't find enough relevant NCERT material for that question. Try rephrasing it, or pick a subject/chapter first.";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", value: msg })}\n\n`));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "meta", sources: [], insufficientContext: true })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", ...corsHeaders(origin) }
    });
  }

  let upstream: Response;
  try {
    upstream = await generateAnswerStream(env, validated.value, sources, body.mode, body.conversation);
  } catch (err) {
    console.error("stream.ts generation error:", err);
    return errorResponse("The tutor could not complete this response. Try again.", 502, origin);
  }

  if (!upstream.ok || !upstream.body) {
    return errorResponse("The tutor could not complete this response. Try again.", 502, origin);
  }

  // Re-shape Groq's OpenAI-compatible SSE chunks into our simpler { type, value } protocol,
  // then append a trailing "meta" event carrying the sources for the source-transparency panel.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const transformed = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", value: token })}\n\n`));
              }
            } catch {
              // Skip malformed keep-alive lines from the upstream provider.
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "meta", sources })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("stream.ts transform error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "token", value: "\n\n_The tutor connection was interrupted._" })}\n\n`)
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(transformed, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders(origin) }
  });
};
