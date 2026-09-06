import { useEffect, useState } from "react";
import { fetchSubjects } from "../lib/api";
import type { Subject } from "../types";
import "./Admin.css";

const KEY_STORAGE = "schoolbook:adminKey";

type Status = { kind: "idle" } | { kind: "working" } | { kind: "done"; chunks: number } | { kind: "error"; message: string };

export function Admin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) ?? "");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [book, setBook] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    fetchSubjects()
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, []);

  const selectedSubject = subjects.find((s) => s.id === subjectId);

  function handleChapterChange(id: string) {
    setChapterId(id);
    const chapter = selectedSubject?.chapters.find((c) => c.id === id);
    if (chapter?.book) setBook(chapter.book);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selectedSubject || !chapterId || !book.trim() || !adminKey.trim()) return;

    sessionStorage.setItem(KEY_STORAGE, adminKey);
    setStatus({ kind: "working" });

    const chapter = selectedSubject.chapters.find((c) => c.id === chapterId);
    const form = new FormData();
    form.set("file", file);
    // subject/chapter must be the IDs the Chapter Explorer filters by — NOT display
    // names — or filtered searches on the main site will silently match nothing.
    form.set("subject", selectedSubject.id);
    form.set("chapter", chapterId);
    form.set("subjectName", selectedSubject.name);
    form.set("chapterName", chapter?.name ?? chapterId);
    form.set("book", book);

    try {
      const res = await fetch("/api/admin/ingest", {
        method: "POST",
        headers: { "X-Admin-Key": adminKey },
        body: form
      });
      const data = (await res.json()) as { chunks?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ingestion failed.");
      setStatus({ kind: "done", chunks: data.chunks ?? 0 });
      setFile(null);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <h1>SchoolBook — Content Ingestion</h1>
        <p className="admin-sub">
          Upload a chapter-wise NCERT PDF (as downloaded from ncert.nic.in) to index it for the tutor. Pick the
          matching subject and chapter from the existing curriculum so retrieval and chapter-filtering stay
          consistent.
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
            Subject
            <select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setChapterId("");
                setBook("");
              }}
              required
            >
              <option value="" disabled>
                Select a subject
              </option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.className} · {s.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Chapter
            <select
              value={chapterId}
              onChange={(e) => handleChapterChange(e.target.value)}
              disabled={!selectedSubject}
              required
            >
              <option value="" disabled>
                Select a chapter
              </option>
              {selectedSubject?.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Book / source
            <input
              type="text"
              value={book}
              onChange={(e) => setBook(e.target.value)}
              placeholder="e.g. NCERT Class 12 Physics Part 1"
              required
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

          <button type="submit" disabled={status.kind === "working"}>
            {status.kind === "working" ? "Indexing…" : "Upload and index"}
          </button>
        </form>

        {status.kind === "done" && (
          <p className="admin-status admin-status--ok">
            Indexed {status.chunks} chunks for {book}.
          </p>
        )}
        {status.kind === "error" && <p className="admin-status admin-status--error">{status.message}</p>}
      </div>
    </div>
  );
}
