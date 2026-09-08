import { getDocumentProxy, extractText } from "unpdf";
import type { Env } from "./env";
import { EMBEDDING_MODEL } from "./rag";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 10; // reduced from 20 — smaller Workers AI / Vectorize payloads, less likely to time out on heavy chapters

// Safety guards for heavy/unexpected uploads (e.g. an admin accidentally uploading
// a whole textbook instead of a single chapter). These fail fast with a clear
// message instead of quietly hanging or burning through retries.
const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_PAGES = 400; // a single NCERT chapter is a few dozen pages at most
const MAX_CHUNKS = 3000; // ~3M+ chars of text — far beyond one chapter
const EXTRACTION_TIMEOUT_MS = 45_000;

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

/**
 * Races a promise against a timeout. Note: on the serverless PDF.js build, parsing
 * is CPU-bound and runs on the main event loop (per unpdf's own docs), so this
 * mainly protects against a hung/slow async step (e.g. a stalled I/O call) rather
 * than truly interrupting a mid-parse CPU spin — but it still turns a silent hang
 * into a clear, actionable error instead of the request just dying.
 */
async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Extracts text for a single page directly via the underlying PDF.js page API.
 * Used only as a fallback when whole-document extraction fails, so one
 * malformed/heavy page doesn't take down the entire chapter's ingestion —
 * the bad page is skipped (returns an empty string) instead of aborting everything.
 */
async function extractSinglePageFallback(pdf: any, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map((item: any) => (typeof item?.str === "string" ? item.str : "")).join(" ");
}

/** Extracts raw per-page text (no chunking) — used both for chunking and for
 * reading the chapter title/subtopics directly off the PDF's own pages. */
export async function extractPdfPages(pdfBytes: Uint8Array): Promise<string[]> {
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    const mb = (pdfBytes.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(
      `PDF is ${mb} MB, which is above the ${MAX_PDF_BYTES / (1024 * 1024)} MB limit for a single chapter upload. ` +
        `Split it into smaller chapter files and upload each separately.`
    );
  }

  let pdf: any;
  try {
    pdf = await getDocumentProxy(pdfBytes);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not open PDF — the file may be corrupted or in an unsupported format: ${detail}`);
  }

  const numPages: number = pdf.numPages;
  if (!numPages || numPages < 1) {
    throw new Error("PDF appears to have no pages — check the file uploaded correctly.");
  }
  if (numPages > MAX_PAGES) {
    throw new Error(
      `PDF has ${numPages} pages, which is above the ${MAX_PAGES}-page limit for a single chapter upload. ` +
        `This looks like it might be a full book rather than one chapter — split it and upload chapter by chapter.`
    );
  }

  // Fast path: extract the whole document in one call (cheapest, works for the vast majority of PDFs).
  try {
    const { text } = await withTimeout(
      () => extractText(pdf, { mergePages: false }) as Promise<{ text: string[] }>,
      EXTRACTION_TIMEOUT_MS,
      "PDF text extraction"
    );
    return text;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`Whole-document extraction failed (${detail}) — falling back to page-by-page extraction.`);
  }

  // Fallback: extract page-by-page so a single bad page doesn't sink the whole chapter.
  const pages: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    try {
      const pageText = await withTimeout(
        () => extractSinglePageFallback(pdf, i),
        EXTRACTION_TIMEOUT_MS,
        `Page ${i} extraction`
      );
      pages.push(pageText);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`Skipping page ${i} of ${numPages} — extraction failed: ${detail}`);
      pages.push("");
    }
  }

  if (pages.every((p) => p.trim().length === 0)) {
    throw new Error(
      `Could not extract any text from this PDF (${numPages} pages, all failed). It may be a scanned/image-only PDF that needs OCR first.`
    );
  }

  return pages;
}

/** Chunks already-extracted per-page text, keeping real page numbers. */
export function chunkPages(pages: string[]): IngestChunk[] {
  const chunks: IngestChunk[] = [];
  pages.forEach((pageText, i) => {
    chunks.push(...chunkPageText(pageText, i + 1));
  });

  if (chunks.length > MAX_CHUNKS) {
    throw new Error(
      `This PDF produced ${chunks.length} chunks, which is above the ${MAX_CHUNKS}-chunk safety limit for a single chapter. ` +
        `This usually means multiple chapters (or a whole textbook) were uploaded as one file — split it and upload chapter by chapter.`
    );
  }

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
  const totalBatches = Math.ceil(chunks.length / EMBED_BATCH_SIZE);
  let total = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;

    let result: { data: number[][] };
    try {
      result = await withRetry(
        () => env.AI.run(EMBEDDING_MODEL, { text: batch.map((c) => c.text) }) as Promise<{ data: number[][] }>
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Embedding step (batch ${batchNum}/${totalBatches}, chunks ${i}-${i + batch.length - 1}) failed after retries: ${detail}. ` +
          `${total} chunks were already embedded and saved before this failure.`
      );
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
      throw new Error(
        `Vectorize upsert step (batch ${batchNum}/${totalBatches}, chunks ${i}-${i + batch.length - 1}) failed after retries: ${detail}. ` +
          `${total} chunks were already embedded and saved before this failure.`
      );
    }
    total += vectors.length;
    console.log(`Ingested batch ${batchNum}/${totalBatches} (${total}/${chunks.length} chunks so far) for ${subjectSlug}-${chapterSlug}`);
  }

  return total;
}
