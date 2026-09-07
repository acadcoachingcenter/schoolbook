import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import "./CoverageNote.css";
import { fetchAvailableChapters } from "../../lib/api";
import type { AvailableChapter } from "../../types";

interface SubjectSummary {
  key: string;
  className: string;
  subjectName: string;
  count: number;
}

function summarize(chapters: AvailableChapter[]): SubjectSummary[] {
  const map = new Map<string, SubjectSummary>();
  for (const c of chapters) {
    const key = c.subjectId;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { key, className: c.className, subjectName: c.subjectName, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => a.className.localeCompare(b.className));
}

export function CoverageNote() {
  const [chapters, setChapters] = useState<AvailableChapter[] | null>(null);

  useEffect(() => {
    fetchAvailableChapters()
      .then(setChapters)
      .catch(() => setChapters([]));
  }, []);

  if (!chapters) return null;

  const summaries = summarize(chapters);
  if (summaries.length === 0) {
    return (
      <p className="coverage-note coverage-note--empty">
        NCERT content is still being added — check back soon, or ask a general question in the meantime.
      </p>
    );
  }

  return (
    <div className="coverage-note">
      <BookMarked size={15} />
      <p>
        Currently covering <strong>{chapters.length} chapter{chapters.length === 1 ? "" : "s"}</strong> across{" "}
        {summaries.map((s, i) => (
          <span key={s.key}>
            <strong>
              {s.className} {s.subjectName}
            </strong>{" "}
            ({s.count})
            {i < summaries.length - 1 ? (i === summaries.length - 2 ? " and " : ", ") : ""}
          </span>
        ))}
        . More chapters are being added regularly.
      </p>
    </div>
  );
}
