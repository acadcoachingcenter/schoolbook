import type { AskRequest, HealthResponse, Subject, TutorResponse } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "Something went wrong.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // ignore parse errors, keep default message
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  return jsonOrThrow<HealthResponse>(res);
}

export async function fetchSubjects(): Promise<Subject[]> {
  const res = await fetch("/api/subjects");
  return jsonOrThrow<Subject[]>(res);
}

/** Non-streaming ask — used as a fallback and for the "quiz-me" structured mode. */
export async function askTutor(payload: AskRequest): Promise<TutorResponse> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return jsonOrThrow<TutorResponse>(res);
}

/**
 * Streaming ask. Reads a text/event-stream of the answer as it's generated,
 * calling onToken for each chunk. Resolves with the final sources once the
 * stream ends (sources are sent as a trailing JSON event).
 */
export async function streamTutor(
  payload: AskRequest,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<{ sources: TutorResponse["sources"]; insufficientContext?: boolean }> {
  const res = await fetch("/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error ?? "The tutor could not complete this response.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sources: TutorResponse["sources"] = [];
  let insufficientContext = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "token") onToken(parsed.value as string);
        if (parsed.type === "meta") {
          sources = parsed.sources ?? [];
          insufficientContext = Boolean(parsed.insufficientContext);
        }
      } catch {
        // Not JSON — treat as a raw token chunk.
        onToken(data);
      }
    }
  }

  return { sources, insufficientContext };
}
