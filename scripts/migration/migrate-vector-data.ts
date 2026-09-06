/**
 * migrate-vector-data.ts
 * ----------------------
 * Offline, one-time (re-runnable) migration: turns source PDFs/CSVs into
 * Cloudflare Vectorize vectors with the same metadata schema the Worker
 * expects (subject, chapter, page, book, snippet).
 *
 * The original RAG-Enhanced-NCERT-Tutor repo used Ollama's `nomic-embed-text`
 * embeddings stored in ChromaDB. Those vectors are NOT compatible with
 * Vectorize's index dimensions/model here, so rather than force-migrating
 * incompatible vectors, this script RE-EMBEDS the source text with
 * Workers AI's `@cf/baai/bge-base-en-v1.5` (768-dim) — see VECTOR_MIGRATION.md
 * for the full rationale.
 *
 * Usage:
 *   1. Put source PDFs in ./source-material/<subject>/<chapter>.pdf
 *      (see source-material/manifest.json for the subject/chapter/book mapping)
 *   2. cp .env.example .env  and fill CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN
 *   3. npm run migrate:vectors
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — pdf-parse has no bundled types
import pdfParse from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ManifestEntry {
  file: string;
  subject: string;
  chapter: string;
  book: string;
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const INDEX_NAME = process.env.VECTORIZE_INDEX || "schoolbook-ncert";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";
const CHUNK_SIZE = 1200; // characters — mirrors the original vector_db_maker.py's spirit, tuned for bge-base's context
const CHUNK_OVERLAP = 150;

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }
  return chunks.filter((c) => c.trim().length > 40);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: texts })
    }
  );
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { result: { data: number[][] } };
  return json.result.data;
}

async function upsertVectors(
  vectors: { id: string; values: number[]; metadata: Record<string, string> }[]
) {
  // Vectorize bulk insert expects NDJSON via the REST API.
  const ndjson = vectors.map((v) => JSON.stringify(v)).join("\n");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/upsert`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/x-ndjson"
      },
      body: ndjson
    }
  );
  if (!res.ok) throw new Error(`Vectorize upsert failed: ${res.status} ${await res.text()}`);
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (see .env.example) before running this script.");
    process.exit(1);
  }

  const manifestPath = path.join(__dirname, "../../source-material/manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest found at ${manifestPath}. Create source-material/manifest.json (see README).`);
    process.exit(1);
  }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  let totalChunks = 0;
  for (const entry of manifest) {
    const pdfPath = path.join(__dirname, "../../source-material", entry.file);
    if (!fs.existsSync(pdfPath)) {
      console.warn(`Skipping missing file: ${pdfPath}`);
      continue;
    }
    const buffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buffer);
    const chunks = chunkText(parsed.text, CHUNK_SIZE, CHUNK_OVERLAP);

    console.log(`${entry.subject} / ${entry.chapter}: ${chunks.length} chunks`);

    const BATCH = 20;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(batch);
      const vectors = batch.map((snippet, j) => ({
        id: `${entry.subject}-${entry.chapter}-${i + j}`.replace(/\s+/g, "-").toLowerCase(),
        values: embeddings[j],
        metadata: {
          subject: entry.subject,
          chapter: entry.chapter,
          book: entry.book,
          page: String(Math.floor((i + j) / 3) + 1), // approximate; refine if you track page breaks during extraction
          snippet
        }
      }));
      await upsertVectors(vectors);
      totalChunks += vectors.length;
      process.stdout.write(`  upserted ${totalChunks} chunks so far\r`);
    }
  }

  console.log(`\nDone. ${totalChunks} chunks embedded and upserted into Vectorize index "${INDEX_NAME}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
