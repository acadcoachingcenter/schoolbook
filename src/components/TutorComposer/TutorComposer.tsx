import { useRef, useState } from "react";
import { Send, Square, Mic } from "lucide-react";
import "./TutorComposer.css";

const SUGGESTIONS = [
  "Explain electromagnetic induction simply",
  "Give me a Class 12 Physics derivation",
  "Why does current decrease in this circuit?",
  "Teach me this chapter for tomorrow's exam"
];

interface Props {
  onSubmit: (question: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  maxLength: number;
}

export function TutorComposer({ onSubmit, onStop, isStreaming, maxLength }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
          onKeyDown={handleKeyDown}
          placeholder="Ask about any NCERT topic — a concept, a derivation, an exam doubt…"
          aria-label="Ask SchoolBook a question"
          rows={3}
        />
        <div className="composer-toolbar">
          <span className="composer-count">
            {value.length}/{maxLength}
          </span>
          <div className="composer-actions">
            <button
              type="button"
              className="icon-btn"
              title="Voice input (coming soon)"
              aria-label="Voice input, coming soon"
              disabled
            >
              <Mic size={17} />
            </button>
            {isStreaming ? (
              <button type="button" className="stop-btn" onClick={onStop}>
                <Square size={15} /> Stop
              </button>
            ) : (
              <button type="button" className="send-btn" onClick={submit} disabled={!value.trim()}>
                <Send size={16} /> Ask
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => onSubmit(s)} disabled={isStreaming}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
