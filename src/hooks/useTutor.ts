import { useCallback, useRef, useState } from "react";
import { streamTutor } from "../lib/api";
import type { ConversationMessage, LearningMode } from "../types";
import type { TurnState } from "../components/TutorResponse/TutorResponse";

const MAX_CONVERSATION_TURNS = 6;

export function useTutor() {
  const [turns, setTurns] = useState<TurnState[]>([]);
  const [mode, setMode] = useState<LearningMode>("explain");
  const [subject, setSubject] = useState<string | undefined>();
  const [chapter, setChapter] = useState<string | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ConversationMessage[]>([]);

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
            conversation: historyRef.current.slice(-MAX_CONVERSATION_TURNS)
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

        historyRef.current.push({ role: "user", content: question }, { role: "assistant", content: fullAnswer });

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

  return {
    turns,
    ask,
    retry,
    stop,
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
