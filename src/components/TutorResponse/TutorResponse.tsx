import ReactMarkdown from "react-markdown";
import { AlertCircle, BookOpenCheck, RotateCcw } from "lucide-react";
import "./TutorResponse.css";
import { SourceCard } from "../SourceCard/SourceCard";
import type { RetrievedSource } from "../../types";

export interface TurnState {
  question: string;
  answer: string;
  sources: RetrievedSource[];
  status: "streaming" | "done" | "error" | "insufficient";
  errorMessage?: string;
}

export function TutorResponse({ turn, onRetry }: { turn: TurnState; onRetry: () => void }) {
  return (
    <article className="turn">
      <p className="turn-question">{turn.question}</p>

      {turn.status === "error" ? (
        <div className="turn-error">
          <AlertCircle size={18} />
          <div>
            <p>{turn.errorMessage ?? "The tutor could not complete this response. Try again."}</p>
            <button className="retry-btn" onClick={onRetry}>
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        </div>
      ) : (
        <div className={`turn-answer ${turn.status === "streaming" ? "turn-answer--streaming" : ""}`}>
          <ReactMarkdown>{turn.answer || " "}</ReactMarkdown>
          {turn.status === "streaming" && <span className="caret" aria-hidden="true" />}
        </div>
      )}

      {turn.status === "done" && turn.sources.length > 0 && (
        <details className="turn-sources" open>
          <summary>
            <BookOpenCheck size={16} /> Why am I seeing this answer? ({turn.sources.length} NCERT source
            {turn.sources.length > 1 ? "s" : ""})
          </summary>
          <ul>
            {turn.sources.map((s, i) => (
              <SourceCard key={s.id} source={s} index={i} />
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
