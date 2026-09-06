import "./LearningModes.css";
import type { LearningMode } from "../../types";

const MODES: { id: LearningMode; label: string; blurb: string }[] = [
  { id: "explain", label: "Explain", blurb: "Simple, clear teaching" },
  { id: "exam", label: "Exam mode", blurb: "Board-exam structure" },
  { id: "deep-dive", label: "Deep dive", blurb: "Full detail & derivations" },
  { id: "quick-revision", label: "Quick revision", blurb: "Scannable bullet notes" },
  { id: "quiz-me", label: "Quiz me", blurb: "Practice questions" },
  { id: "socratic", label: "Socratic", blurb: "Guided questions first" }
];

interface Props {
  value: LearningMode;
  onChange: (mode: LearningMode) => void;
}

export function LearningModes({ value, onChange }: Props) {
  return (
    <div className="modes" role="tablist" aria-label="Learning mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={value === m.id}
          className={`mode-tab ${value === m.id ? "mode-tab--active" : ""}`}
          onClick={() => onChange(m.id)}
          title={m.blurb}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
