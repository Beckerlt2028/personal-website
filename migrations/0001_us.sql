CREATE TABLE IF NOT EXISTS letters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'shared')),
  opened_at TEXT,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS letters_author ON letters(author);
CREATE INDEX IF NOT EXISTS letters_recipient ON letters(recipient, status);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,
  version INTEGER NOT NULL
);
