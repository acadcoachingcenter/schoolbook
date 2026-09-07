import { getDocumentProxy, extractText } from "unpdf";
import type { Env } from "./env";
import { EMBEDDING_MODEL } from "./rag";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 20;

export interface IngestChunk {
  page: number;
  text: string;
}

/** Splits a single page's text into overlapping chunks, keeping page numbers exact. */
function chunkPageText(pageText: string, page: number): IngestChunk[] {
  const cleaned = pageText.replace(/\s+/g, " ").trim();
  if (cleaned.length < 40) return [];

  const chunks: IngestChunk[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + CHUNK_SIZE, cleaned.length);
    const text = cleaned.slice(start, end);
    if (text.trim().length > 40) chunks.push({ page, text });
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/** Extracts raw per-page text (no chunking) — used both for chunking and for
 * reading the chapter title/subtopics directly off the PDF's own pages. */
export async function extractPdfPages(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Chunks already-extracted per-page text, keeping real page numbers. */
export function chunkPages(pages: string[]): IngestChunk[] {
  const chunks: IngestChunk[] = [];
  pages.forEach((pageText, i) => {
    chunks.push(...chunkPageText(pageText, i + 1));
  });
  return chunks;
}

/** Extracts text per page from a PDF ArrayBuffer/Uint8Array and chunks it with real page numbers. */
export async function extractAndChunkPdf(pdfBytes: Uint8Array): Promise<IngestChunk[]> {
  const pages = await extractPdfPages(pdfBytes);
  return chunkPages(pages);
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface IngestMetadata {
  subject: string;
  chapter: string;
  book: string;
  /** Human-readable labels for display in the Source card — separate from the
   * subject/chapter values above, which must match the IDs the Chapter Explorer
   * filters by (e.g. "electric-charges-and-fields"), not display text. */
  subjectName?: string;
  chapterName?: string;
}

/** Retries a flaky async call a couple of times with a short backoff before giving up —
 * absorbs the occasional transient Workers AI / Vectorize hiccup instead of failing
 * the whole upload over a momentary blip. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Embeds chunks in batches via Workers AI and upserts them into Vectorize.
 * Vector IDs are deterministic (subject-chapter-page-index), so re-ingesting
 * the same chapter overwrites its previous chunks rather than duplicating them.
 */
export async function embedAndUpsertChunks(env: Env, chunks: IngestChunk[], meta: IngestMetadata): Promise<number> {
  const subjectSlug = slug(meta.subject);
  const chapterSlug = slug(meta.chapter);
  let total = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);

    let result: { data: number[][] };
    try {
      result = await withRetry(
        () => env.AI.run(EMBEDDING_MODEL, { text: batch.map((c) => c.text) }) as Promise<{ data: number[][] }>
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Embedding step (batch starting at chunk ${i}) failed after retries: ${detail}`);
    }

    const vectors = batch.map((chunk, j) => ({
      id: `${subjectSlug}-${chapterSlug}-p${chunk.page}-${i + j}`,
      values: Array.from(result.data[j]),
      metadata: {
        subject: meta.subject,
        chapter: meta.chapter,
        subjectName: meta.subjectName ?? meta.subject,
        chapterName: meta.chapterName ?? meta.chapter,
        book: meta.book,
        page: String(chunk.page),
        snippet: chunk.text
      }
    }));

    try {
      await withRetry(() => env.VECTORIZE.upsert(vectors));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Vectorize upsert step (batch starting at chunk ${i}) failed after retries: ${detail}`);
    }
    total += vectors.length;
  }

  return total;
}