import { useEffect, useMemo, useState } from "react";
import { BookMarked, ChevronDown, CheckCircle2 } from "lucide-react";
import "./CoverageNote.css";
import { fetchAvailableChapters } from "../../lib/api";
import type { AvailableChapter } from "../../types";

interface SubjectSummary {
  key: string;
  className: string;
  subjectName: string;
  count: number;
}

interface BookGroup {
  book: string;
  chapters: AvailableChapter[];
}

interface SubjectGroup {
  key: string;
  className: string;
  subjectName: string;
  books: BookGroup[];
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

/** Groups Class → Subject → Book/Part → Chapters, for the detailed status table. */
function groupForTable(chapters: AvailableChapter[]): SubjectGroup[] {
  const subjectMap = new Map<string, SubjectGroup>();
  for (const c of chapters) {
    let subject = subjectMap.get(c.subjectId);
    if (!subject) {
      subject = { key: c.subjectId, className: c.className, subjectName: c.subjectName, books: [] };
      subjectMap.set(c.subjectId, subject);
    }
    let book = subject.books.find((b) => b.book === c.book);
    if (!book) {
      book = { book: c.book, chapters: [] };
      subject.books.push(book);
    }
    book.chapters.push(c);
  }
  return Array.from(subjectMap.values()).sort((a, b) => a.className.localeCompare(b.className));
}

export function CoverageNote() {
  const [chapters, setChapters] = useState<AvailableChapter[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchAvailableChapters()
      .then(setChapters)
      .catch(() => setChapters([]));
  }, []);

  const summaries = useMemo(() => (chapters ? summarize(chapters) : []), [chapters]);
  const table = useMemo(() => (chapters ? groupForTable(chapters) : []), [chapters]);

  if (!chapters) return null;

  if (summaries.length === 0) {
    return (
      <p className="coverage-note coverage-note--empty">
        NCERT content is still being added — check back soon, or ask a general question in the meantime.
      </p>
    );
  }

  return (
    <div className="coverage-note">
      <div className="coverage-note-summary">
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
        <button
          type="button"
          className="coverage-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <ChevronDown size={14} className={expanded ? "coverage-chevron--open" : ""} />
          {expanded ? "Hide details" : "View full status"}
        </button>
      </div>

      {expanded && (
        <div className="coverage-table">
          {table.map((subject) => (
            <div key={subject.key} className="coverage-table-subject">
              <h4>
                {subject.className} · {subject.subjectName}
              </h4>
              {subject.books.map((book) => (
                <div key={book.book} className="coverage-table-book">
                  <p className="coverage-table-book-label">{book.book}</p>
                  <ul>
                    {book.chapters.map((c) => (
                      <li key={c.chapterId}>
                        <CheckCircle2 size={14} className="coverage-done-icon" />
                        <span>{c.chapterTitle}</span>
                        <span className="coverage-done-tag">Done</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
