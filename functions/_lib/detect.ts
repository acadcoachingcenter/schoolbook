export interface DetectedChapterInfo {
  chapterTitle: string;
  subtopics: string[];
}

/**
 * NCERT chapter PDFs consistently open with "Chapter <word>" followed by
 * a multi-line ALL-CAPS title (e.g. "ELECTRIC CHARGES" / "AND FIELDS").
 * This reads that directly from the PDF's own first page instead of relying
 * on a fixed subjects.json list, which goes stale whenever NCERT revises a
 * syllabus (exactly what happened with the source repo this app started from).
 */
export function detectChapterInfo(pages: string[]): DetectedChapterInfo {
  const firstPage = pages[0] ?? "";
  const lines = firstPage
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let title = "";
  const chapterLineIdx = lines.findIndex((l) => /^chapter\s+\S+/i.test(l));
  if (chapterLineIdx !== -1) {
    const titleLines: string[] = [];
    for (let i = chapterLineIdx + 1; i < lines.length && titleLines.length < 4; i++) {
      const line = lines[i];
      if (/^\d+\.\d+\s/.test(line)) break; // hit the first numbered heading — title is done
      if (/^[A-Z0-9 &,.'-]{3,}$/.test(line) && /[A-Z]/.test(line)) {
        titleLines.push(line);
      } else if (titleLines.length > 0) {
        break;
      }
    }
    title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  }

  if (!title) {
    // Fallback: first run of 2+ consecutive ALL-CAPS lines near the top of page 1.
    const capsRun: string[] = [];
    for (const line of lines.slice(0, 15)) {
      const isNoise = /^(NCERT|PHYSICS|CHEMISTRY|BIOLOGY|MATHEMATICS|REPRINT)/i.test(line);
      if (!isNoise && /^[A-Z0-9 &,.'-]{3,}$/.test(line) && /[A-Z]/.test(line)) {
        capsRun.push(line);
      } else if (capsRun.length >= 2) {
        break;
      } else {
        capsRun.length = 0;
      }
    }
    title = capsRun.join(" ").replace(/\s+/g, " ").trim();
  }

  // Best-effort numbered subtopic headings, e.g. "2.1 Introduction" — supplementary
  // metadata only, not load-bearing, since heading extraction from dense PDF layouts
  // is inherently imperfect.
  const subtopics = new Set<string>();
  for (const page of pages) {
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.trim();
      const match = line.match(/^(\d{1,2}\.\d{1,2})\s+([A-Za-z][A-Za-z0-9 ,.'&-]{2,60})$/);
      if (match) subtopics.add(`${match[1]} ${match[2].trim()}`);
    }
  }

  return {
    chapterTitle: title || "Untitled chapter",
    subtopics: Array.from(subtopics).slice(0, 40)
  };
}
