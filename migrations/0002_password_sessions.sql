CREATE TABLE IF NOT EXISTS password_sessions (
  id_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  tokens TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_sessions_expiry ON password_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
