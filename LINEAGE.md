# Lineage: from RAG-Enhanced-NCERT-Tutor to SchoolBook

This app is a from-scratch rebuild, informed by an audit of the
`RAG-Enhanced-NCERT-Tutor` repo. Nothing was blindly deleted or copy-pasted;
here's exactly what was found, kept, and replaced.

## What the original repo contained
- `streamlit_app.py` — Streamlit chat UI calling a local FastAPI server.
- `app.py` — FastAPI server: loads a Chroma vector DB, embeds queries with
  Ollama's `nomic-embed-text`, re-ranks with an `LLMChainExtractor`, and
  generates answers with Groq's `llama3-8b-8192`. Contained a **hardcoded
  Groq API key** (`groq_api_key = "API_KEY"`) — a security issue, removed.
- `vector_db_maker.py` — extracts text from NCERT PDFs with `pdfplumber`,
  chunks with `RecursiveCharacterTextSplitter` (1800/200), embeds with
  Ollama, persists to Chroma.
- Three Chroma DBs (`vector_db/`, `vector_db_science_book/`,
  `vector_db_eng_hornbill/`) plus `eng_book.csv`, `science_book_ques.csv`,
  two NCERT Class 12 Physics PDFs, `eval.ipynb`, `evaluation_script.py`.
- Prompt: "Answer the question based ONLY on the following context" —
  the right instinct, kept and strengthened (see `functions/_lib/prompt.ts`).

## What could not be migrated as-is
- **The Chroma vectors themselves.** They were produced by
  `nomic-embed-text` running locally in Ollama — a different model, different
  dimensionality, and not something a Cloudflare Worker can run. Vectorize
  needs vectors from a model it (or you) can actually call at query time.
  Forcing incompatible vectors into Vectorize would silently break
  similarity search. Instead, `scripts/migration/migrate-vector-data.ts`
  **re-embeds the original source PDFs** with Workers AI's
  `@cf/baai/bge-base-en-v1.5` — see `VECTOR_MIGRATION.md`.
- **Streamlit and FastAPI.** Both require a persistently running server;
  neither runs in a Cloudflare Worker. Replaced by the Vite/React frontend
  and Cloudflare Pages Functions in `functions/api/`.
- **`LLMChainExtractor` re-ranking.** This called the LLM once per candidate
  document to compress/extract relevant text — effectively N+1 LLM calls per
  question. Replaced with Vectorize's native similarity score + a
  `MIN_SCORE` threshold (see `functions/_lib/rag.ts`), which is faster,
  cheaper, and avoids the "unnecessary multiple LLM calls" the original
  architecture had.

## What was kept in spirit
- The "answer only from retrieved context" grounding principle — now a
  stricter system prompt with explicit anti-hallucination rules
  (`functions/_lib/prompt.ts`).
- Page/source metadata on every retrieved chunk, shown to the student
  (`SourceCard.tsx`) instead of only logged server-side.
- An evaluation workflow (`tools/offline/evaluate.py`) that measures
  retrieval recall and answer failure rate, so this pipeline's quality can be
  compared against the original's `RAG_evaluation_result.png` numbers.

## What was rebuilt from scratch
- The entire UI: this was a from-scratch design (see `README.md` and the
  in-code comments in `src/styles/global.css`), not a Streamlit reskin. Modes,
  source transparency, and chapter navigation are new interaction patterns.
- The API shape (`/api/ask`, `/api/stream`, `/api/subjects`, `/api/chapters`,
  `/api/health`) is new, designed around Cloudflare Pages Functions rather
  than mirroring FastAPI's single `/ask` route.
