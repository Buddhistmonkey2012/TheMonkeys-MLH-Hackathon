CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_salt TEXT,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS google_states (
  token_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  account_id TEXT,
  session_hash TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_states_expiry ON google_states(expires_at);
CREATE TABLE IF NOT EXISTS auth_limits (
  key TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limits_slot ON auth_limits(slot);
