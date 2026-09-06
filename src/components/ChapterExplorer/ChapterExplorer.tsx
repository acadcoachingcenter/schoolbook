import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import "./ChapterExplorer.css";
import { fetchSubjects } from "../../lib/api";
import type { Chapter, Subject } from "../../types";

interface Props {
  selectedSubject?: string;
  selectedChapter?: string;
  onSelect: (subject?: string, chapter?: string) => void;
}

export function ChapterExplorer({ selectedSubject, selectedChapter, onSelect }: Props) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [openSubject, setOpenSubject] = useState<string | null>(selectedSubject ?? null);

  useEffect(() => {
    fetchSubjects()
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, []);

  if (!subjects) return null;
  if (subjects.length === 0) return null;

  const activeChapterName =
    selectedSubject &&
    subjects.find((s) => s.id === selectedSubject)?.chapters.find((c: Chapter) => c.id === selectedChapter)?.name;

  return (
    <div className="explorer">
      <div className="explorer-header">
        <span>Focus a subject or chapter</span>
        {(selectedSubject || selectedChapter) && (
          <button className="explorer-clear" onClick={() => onSelect(undefined, undefined)}>
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {selectedSubject && activeChapterName ? (
        <p className="explorer-active">
          Searching within <strong>{activeChapterName}</strong>
        </p>
      ) : (
        <ul className="explorer-list">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <button
                className={`explorer-subject ${openSubject === subject.id ? "explorer-subject--open" : ""}`}
                onClick={() => setOpenSubject(openSubject === subject.id ? null : subject.id)}
              >
                <ChevronRight size={14} className="explorer-chevron" />
                {subject.className} · {subject.name}
              </button>
              {openSubject === subject.id && (
                <ul className="explorer-chapters">
                  {subject.chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <button onClick={() => onSelect(subject.id, chapter.id)}>{chapter.name}</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
