import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import "./ChapterExplorer.css";
import { fetchAvailableChapters } from "../../lib/api";
import type { AvailableChapter } from "../../types";

interface Props {
  selectedSubject?: string;
  selectedChapter?: string;
  onSelect: (subject?: string, chapter?: string) => void;
}

interface SubjectGroup {
  subjectId: string;
  subjectName: string;
  className: string;
  chapters: AvailableChapter[];
}

function groupBySubject(chapters: AvailableChapter[]): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const chapter of chapters) {
    const existing = groups.get(chapter.subjectId);
    if (existing) {
      existing.chapters.push(chapter);
    } else {
      groups.set(chapter.subjectId, {
        subjectId: chapter.subjectId,
        subjectName: chapter.subjectName,
        className: chapter.className,
        chapters: [chapter]
      });
    }
  }
  return Array.from(groups.values());
}

export function ChapterExplorer({ selectedSubject, selectedChapter, onSelect }: Props) {
  const [chapters, setChapters] = useState<AvailableChapter[] | null>(null);
  const [openSubject, setOpenSubject] = useState<string | null>(selectedSubject ?? null);

  useEffect(() => {
    fetchAvailableChapters()
      .then(setChapters)
      .catch(() => setChapters([]));
  }, []);

  if (!chapters) return null;
  if (chapters.length === 0) return null;

  const groups = groupBySubject(chapters);

  const activeChapterTitle =
    selectedSubject &&
    chapters.find((c) => c.subjectId === selectedSubject && c.chapterId === selectedChapter)?.chapterTitle;

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

      {selectedSubject && activeChapterTitle ? (
        <p className="explorer-active">
          Searching within <strong>{activeChapterTitle}</strong>
        </p>
      ) : (
        <ul className="explorer-list">
          {groups.map((group) => (
            <li key={group.subjectId}>
              <button
                className={`explorer-subject ${openSubject === group.subjectId ? "explorer-subject--open" : ""}`}
                onClick={() => setOpenSubject(openSubject === group.subjectId ? null : group.subjectId)}
              >
                <ChevronRight size={14} className="explorer-chevron" />
                {group.className} · {group.subjectName}
              </button>
              {openSubject === group.subjectId && (
                <ul className="explorer-chapters">
                  {group.chapters.map((chapter) => (
                    <li key={chapter.chapterId}>
                      <button onClick={() => onSelect(chapter.subjectId, chapter.chapterId)}>
                        {chapter.chapterTitle}
                      </button>
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
