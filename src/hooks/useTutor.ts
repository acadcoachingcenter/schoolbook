import { useCallback, useEffect, useRef, useState } from "react";
import { streamTutor, fetchConversation } from "../lib/api";
import { getSessionId, resetSessionId } from "../lib/session";
import type { LearningMode } from "../types";
import type { TurnState } from "../components/TutorResponse/TutorResponse";

export function useTutor() {
  const [turns, setTurns] = useState<TurnState[]>([]);
  const [mode, setMode] = useState<LearningMode>("explain");
  const [subject, setSubject] = useState<string | undefined>();
  const [chapter, setChapter] = useState<string | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(getSessionId());

  // Restore recent history from D1 on first load, so a refresh doesn't lose the conversation.
  useEffect(() => {
    fetchConversation(sessionIdRef.current)
      .then((messages) => {
        const restored: TurnState[] = [];
        for (let i = 0; i < messages.length; i += 2) {
          const question = messages[i];
          const answer = messages[i + 1];
          if (question?.role === "user" && answer?.role === "assistant") {
            restored.push({ question: question.content, answer: answer.content, sources: [], status: "done" });
          }
        }
        if (restored.length > 0) setTurns(restored);
      })
      .catch(() => {
        // No history yet, or D1 unavailable — starting fresh is a fine fallback either way.
      });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const turnIndex = turns.length;
      setTurns((prev) => [...prev, { question, answer: "", sources: [], status: "streaming" }]);

      try {
        let fullAnswer = "";
        const { sources, insufficientContext } = await streamTutor(
          {
            question,
            mode,
            subject,
            chapter,
            sessionId: sessionIdRef.current
          },
          (token) => {
            fullAnswer += token;
            setTurns((prev) => {
              const next = [...prev];
              next[turnIndex] = { ...next[turnIndex], answer: fullAnswer };
              return next;
            });
          },
          controller.signal
        );

        setTurns((prev) => {
          const next = [...prev];
          next[turnIndex] = {
            ...next[turnIndex],
            answer: fullAnswer,
            sources,
            status: insufficientContext ? "insufficient" : "done"
          };
          return next;
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setTurns((prev) => {
            const next = [...prev];
            next[turnIndex] = { ...next[turnIndex], status: "done" };
            return next;
          });
        } else {
          setTurns((prev) => {
            const next = [...prev];
            next[turnIndex] = {
              ...next[turnIndex],
              status: "error",
              errorMessage: (err as Error).message
            };
            return next;
          });
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [turns.length, mode, subject, chapter]
  );

  const retry = useCallback(
    (index: number) => {
      const question = turns[index]?.question;
      if (question) ask(question);
    },
    [turns, ask]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newConversation = useCallback(() => {
    sessionIdRef.current = resetSessionId();
    setTurns([]);
  }, []);

  return {
    turns,
    ask,
    retry,
    stop,
    newConversation,
    isStreaming,
    mode,
    setMode,
    subject,
    chapter,
    setFocus: (s?: string, c?: string) => {
      setSubject(s);
      setChapter(c);
    }
  };
}
