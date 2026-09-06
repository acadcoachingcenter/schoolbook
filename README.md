# SchoolBook — NCERT AI Learning Companion

SchoolBook is a Cloudflare-native AI tutor: ask a question, get an answer
grounded in actual NCERT textbook pages, and see exactly which pages it
came from. Rebuilt from the ground up from the audited
`RAG-Enhanced-NCERT-Tutor` (Streamlit + FastAPI + Chroma + Ollama) into a
Vite/React frontend backed by Cloudflare Pages Functions, Vectorize, and
Groq — see `LINEAGE.md` for exactly what was kept, replaced, and why.

```
Student
   ↓
Vite + React (this repo, /src)
   ↓
Cloudflare Pages
   ↓
Pages Functions API (/functions/api/*)
   ↓
Vectorize  ← Workers AI (query embedding)
   ↓
NCERT context (subject / chapter / page / snippet)
   ↓
Groq LLM (grounded, streamed)
   ↓
Streaming tutor response + source cards
```

No Streamlit, no FastAPI/Uvicorn, no Ollama, no always-on server, and no
localhost dependency in production — everything ships as one Cloudflare
Pages project.

## Project structure

```
src/                    Vite + React frontend
  components/           Hero, TutorComposer, TutorResponse, SourceCard,
                         LearningModes, ChapterExplorer
  pages/Home.tsx         Assembles the above into the main experience
  hooks/useTutor.ts       Streaming + bounded conversation state
  lib/api.ts              Fetch client for /api/*
  types/index.ts          Shared TS data contracts

functions/api/           Cloudflare Pages Functions (the API)
  ask.ts / stream.ts      RAG endpoints (non-streaming / streaming)
  subjects.ts / chapters.ts   Navigation metadata
  health.ts               Health check
functions/_lib/           rag.ts, prompt.ts, env.ts — shared server logic

scripts/migration/        Offline: re-embed source PDFs into Vectorize
source-material/           Where you place NCERT PDFs + manifest.json
tools/offline/             Python evaluation script (not a runtime dependency)
data/subjects.json         Subject/chapter navigation data — replace with
                            ACAD's real Class 6-12 curriculum list
```

## Local development

```bash
npm install
cp .env.example .env          # fill in GROQ_API_KEY for local testing

# Terminal 1: run the API + bindings locally
npm run build
npm run pages:dev             # wrangler pages dev, serves dist/ + functions/ on :8788

# Terminal 2: run the frontend with hot reload, proxying /api to :8788
npm run dev                   # http://localhost:5173
```

`npm run pages:dev` uses local emulation for Vectorize/D1/KV; Workers AI and
Groq calls still hit the real network, so you'll need a real `GROQ_API_KEY`
and a real Vectorize index (below) even in dev.

## One-time Cloudflare setup

1. **Create the Vectorize index:**
   ```bash
   npm run vectorize:create
   ```
2. **Create the D1 database and KV namespace** (used for bounded
   conversation memory and metadata caching):
   ```bash
   wrangler d1 create schoolbook-db
   wrangler kv namespace create CACHE
   ```
   Copy the returned IDs into `wrangler.toml` (`database_id`, `id`), then
   apply the schema:
   ```bash
   npm run d1:migrate
   ```
3. **Set secrets** (never commit these, never prefix with `VITE_`):
   ```bash
   wrangler pages secret put GROQ_API_KEY --project-name=schoolbook
   wrangler pages secret put GROQ_MODEL --project-name=schoolbook
   ```
4. **Migrate the NCERT vector data** — see `VECTOR_MIGRATION.md` for the
   full explanation; short version:
   ```bash
   # put PDFs in source-material/, describe them in source-material/manifest.json
   npm run migrate:vectors
   ```

## Deploying

```bash
npm run build
npm run pages:deploy
```

Or connect the GitHub repo directly in the Cloudflare dashboard
(**Workers & Pages → Create → Pages → Connect to Git**) so every push to
`main` auto-deploys:
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/` (this repo has no nested `/app` split — everything
  under `src/` and `functions/` is the deployed app)

### Custom domain

In the Pages project → **Custom domains** → add `schoolbooks.acadapp.in`,
then add the CNAME record Cloudflare shows you under the `acadapp.in` zone
(if `acadapp.in` is already on Cloudflare DNS, this is a one-click "Activate"
rather than a manual record).

## Testing after deploy

```bash
curl https://schoolbooks.acadapp.in/api/health
# {"status":"ok","service":"schoolbook-ncert-tutor","rag":true}
```

Then ask a real question through the UI, e.g. "Explain electromagnetic
induction simply" — you should see a streamed answer and a "Why am I seeing
this answer?" panel listing the NCERT sources used.

## Security notes

- API keys live only in Cloudflare Pages secrets; the React bundle never
  receives them (no `VITE_GROQ_*` variables exist anywhere).
- `/api/ask` and `/api/stream` validate question length (1200 chars) and
  strip control characters before use.
- The system prompt (`functions/_lib/prompt.ts`) is the authority on what
  the model will and won't do — user input is treated as data appended
  after it, not as instructions, which is the main defense against
  prompt injection here.
- CORS is restricted to `*.acadapp.in` and localhost, not a wildcard.

## Remaining limitations / production checklist

- [ ] `data/subjects.json` currently contains placeholder Physics/Science/
      English chapters carried over from the audited repo — replace with
      ACAD's actual Class 6–12 subject/chapter list.
- [ ] Rate limiting is not yet implemented at the Worker level — add a
      Cloudflare Rate Limiting rule on `/api/*` before public launch.
- [ ] No automated test suite is included yet; `tools/offline/evaluate.py`
      covers retrieval/faithfulness spot-checks but isn't CI-wired.
- [ ] Only Groq is wired as an LLM provider; swapping providers means
      editing `functions/_lib/rag.ts`'s two `fetch` calls.
- [ ] Conversation history is anonymous, bucketed only by a browser-local
      session id (`src/lib/session.ts`) with no expiry job yet — see the
      housekeeping note at the bottom of `schema/schema.sql` for pruning
      old rows once this is in real use.
