-- SchoolBook D1 schema: bounded conversation memory.
-- Run from the folder where wrangler.toml lives:
--   wrangler d1 execute schoolbook-db --remote --file=./schema/schema.sql

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  mode TEXT,
  subject TEXT,
  chapter TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Fast lookup of a session's history in chronological order.
CREATE INDEX IF NOT EXISTS idx_conversation_session_created
  ON conversation_messages (session_id, created_at);

-- Housekeeping: sessions are anonymous and short-lived by design (no accounts yet),
-- so old rows are safe to prune periodically, e.g. via a scheduled Worker or manually:
--   DELETE FROM conversation_messages WHERE created_at < unixepoch() - 60*60*24*30;
