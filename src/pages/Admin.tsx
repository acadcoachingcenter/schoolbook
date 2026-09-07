import { useEffect, useState } from "react";
import "./Admin.css";

const KEY_STORAGE = "schoolbook:adminKey";
const CLASSES = ["Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"];
const COOLDOWN_SECONDS = 20; // spaces out consecutive uploads to avoid tripping transient rate limits

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; chapterTitle: string; subtopics: string[]; chunks: number }
  | { kind: "error"; message: string };

export function Admin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) ?? "");
  const [className, setClassName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [chapterTitleOverride, setChapterTitleOverride] = useState("");
  const [book, setBook] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !className || !subjectName.trim() || !adminKey.trim() || cooldown > 0) return;

    sessionStorage.setItem(KEY_STORAGE, adminKey);
    setStatus({ kind: "working" });

    const form = new FormData();
    form.set("file", file);
    form.set("className", className);
    form.set("subjectName", subjectName.trim());
    if (chapterTitleOverride.trim()) form.set("chapterTitle", chapterTitleOverride.trim());
    if (book.trim()) form.set("book", book.trim());

    try {
      const res = await fetch("/api/admin/ingest", {
        method: "POST",
        headers: { "X-Admin-Key": adminKey },
        body: form
      });
      const data = (await res.json()) as {
        chapterTitle?: string;
        subtopics?: string[];
        chunks?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Ingestion failed.");
      setStatus({
        kind: "done",
        chapterTitle: data.chapterTitle ?? "",
        subtopics: data.subtopics ?? [],
        chunks: data.chunks ?? 0
      });
      setFile(null);
      setChapterTitleOverride("");
      setCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
      // No cooldown on failure — a genuine mistake (bad file, wrong field) shouldn't force a wait to fix and retry.
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <h1>SchoolBook — Content Ingestion</h1>
        <p className="admin-sub">
          Upload a chapter-wise NCERT PDF (as downloaded from ncert.nic.in). The chapter title is read directly
          from the PDF's own title page — no fixed chapter list to keep in sync when NCERT revises a syllabus.
          Only Class and Subject need picking; leave "Chapter title" blank unless the auto-detected one needs
          correcting.
        </p>

        <form onSubmit={handleSubmit} className="admin-form">
          <label>
            Admin key
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Shared ingestion key"
              required
            />
          </label>

          <label>
            Class
            <select value={className} onChange={(e) => setClassName(e.target.value)} required>
              <option value="" disabled>
                Select a class
              </option>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            Subject
            <input
              type="text"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g. Physics, Mathematics, Science"
              required
            />
          </label>

          <label>
            Chapter title <span className="admin-optional">(optional — auto-detected if left blank)</span>
            <input
              type="text"
              value={chapterTitleOverride}
              onChange={(e) => setChapterTitleOverride(e.target.value)}
              placeholder="Leave blank to auto-detect from the PDF"
            />
          </label>

          <label>
            Book / source <span className="admin-optional">(optional)</span>
            <input
              type="text"
              value={book}
              onChange={(e) => setBook(e.target.value)}
              placeholder="e.g. NCERT Class 12 Physics Part 1"
            />
          </label>

          <label>
            PDF file
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>

          <button type="submit" disabled={status.kind === "working" || cooldown > 0}>
            {status.kind === "working" ? "Indexing…" : cooldown > 0 ? `Wait ${cooldown}s…` : "Upload and index"}
          </button>
        </form>

        {status.kind === "done" && (
          <div className="admin-status admin-status--ok">
            <p>
              Indexed {status.chunks} chunks for <strong>{status.chapterTitle}</strong>.
            </p>
            {status.subtopics.length > 0 && (
              <p className="admin-subtopics">Detected subtopics: {status.subtopics.join(", ")}</p>
            )}
          </div>
        )}
        {status.kind === "error" && <p className="admin-status admin-status--error">{status.message}</p>}
      </div>
    </div>
  );
}