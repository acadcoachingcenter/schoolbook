# Vector Database Migration

## Current vector database (source)
- **Engine:** ChromaDB (SQLite-backed, persisted to disk) — three separate
  DBs in the original repo: `vector_db/`, `vector_db_science_book/`,
  `vector_db_eng_hornbill/`.
- **Embedding model:** Ollama `nomic-embed-text`, run locally.
- **Chunking:** `RecursiveCharacterTextSplitter`, chunk size 1800 chars,
  overlap 200, one chunk per PDF page block, in `vector_db_maker.py`.
- **Metadata per chunk:** `source` (file path), `page` (int).
- **Incompatibility:** `nomic-embed-text` vectors have a different
  dimensionality/space than any model Vectorize or Workers AI can compare
  against at query time, and there's no Ollama runtime available inside a
  Cloudflare Worker. The vectors cannot be copied over — only the
  **source text** they were built from is reusable.

## Target vector database
- **Engine:** [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/)
- **Index name:** `schoolbook-ncert`
- **Embedding model:** Workers AI `@cf/baai/bge-base-en-v1.5`
- **Dimensions:** 768
- **Metric:** cosine
- **Chunking:** plain character-based chunking, 1200 chars, 150 overlap
  (`scripts/migration/migrate-vector-data.ts`) — tuned for `bge-base`'s
  effective context rather than reusing the original 1800/200 split verbatim.

## Metadata schema
Every vector carries this metadata (matches `RetrievedSource` in
`src/types/index.ts`):

| field     | type   | example                              |
|-----------|--------|---------------------------------------|
| `subject` | string | `"Physics"`                          |
| `chapter` | string | `"electromagnetic-induction"`        |
| `book`    | string | `"NCERT Class 12 Physics Part 2"`    |
| `page`    | string | `"114"`                              |
| `snippet` | string | the chunk text itself (used directly as the retrieved context, and shown to the student in the Source card) |

`subject` and `chapter` are also used as Vectorize metadata **filters** when
the student has focused the Chapter Explorer on a specific subject/chapter.

## Index creation
```bash
npm run vectorize:create
# equivalent to:
wrangler vectorize create schoolbook-ncert --dimensions=768 --metric=cosine
```

## Upload / migration process
1. Place source PDFs under `source-material/` and describe them in
   `source-material/manifest.json` (subject, chapter, book, filename).
2. Copy `.env.example` to `.env` and fill in:
   ```
   CLOUDFLARE_ACCOUNT_ID=...
   CLOUDFLARE_API_TOKEN=...   # needs Vectorize:Edit + Workers AI:Read
   ```
3. Run:
   ```bash
   npm run migrate:vectors
   ```
   This extracts text (`pdf-parse`), chunks it, calls the Workers AI REST
   API in batches of 20 to embed each chunk, and upserts the resulting
   vectors (with metadata) into the Vectorize index via its bulk NDJSON
   upsert endpoint.
4. Re-run any time source material changes — vector IDs are derived
   deterministically from `subject-chapter-chunkIndex`, so re-running
   overwrites rather than duplicates existing entries for the same source.

## Environment variables involved
See `.env.example` for the full list. The migration script only needs
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `VECTORIZE_INDEX`, and
`EMBEDDING_MODEL`. The deployed Worker itself never uses these — it talks to
Vectorize and Workers AI through the `[[vectorize]]` and `[ai]` bindings in
`wrangler.toml`, which don't need an API token.

## Deployment instructions
See the "Vector data & RAG setup" section in `README.md` for the end-to-end
sequence (create index → set secrets → migrate → deploy → test).

## Preserving the original knowledge base
- The two Physics PDFs and the English/Science CSV question sets from the
  original repo are legitimate source material — keep them in
  `source-material/` locally (they're git-ignored) or move them to a
  Cloudflare R2 bucket for longer-term storage; **do not** commit large PDFs
  to this repo or let them get bundled into the Vite build.
- The original `eval.ipynb` / `evaluation_script.py` methodology is
  preserved conceptually in `tools/offline/evaluate.py`, adapted to hit
  `/api/ask` instead of a local FastAPI server.
