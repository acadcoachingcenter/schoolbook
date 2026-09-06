import { useState } from "react";
import "./SourceCard.css";
import type { RetrievedSource } from "../../types";

function relevanceLabel(score?: number): string {
  if (score === undefined) return "";
  if (score >= 0.8) return "Strong match";
  if (score >= 0.65) return "Good match";
  return "Possible match";
}

export function SourceCard({ source, index }: { source: RetrievedSource; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="source-card">
      <div className="source-card-head">
        <span className="source-index">{index + 1}</span>
        <div>
          <p className="source-title">
            {source.subject ?? "NCERT"} {source.chapter ? `· ${source.chapter}` : ""}
          </p>
          <p className="source-meta">
            {source.book ? `${source.book} · ` : ""}
            {source.page ? `Page ${source.page}` : "Page unknown"}
            {source.score !== undefined ? ` · ${relevanceLabel(source.score)}` : ""}
          </p>
        </div>
      </div>
      <p className={`source-snippet ${expanded ? "source-snippet--expanded" : ""}`}>{source.snippet}</p>
      {source.snippet.length > 180 && (
        <button className="source-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more context"}
        </button>
      )}
    </li>
  );
}
