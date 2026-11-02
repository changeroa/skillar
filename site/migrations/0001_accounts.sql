CREATE TABLE users (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

-- Session IDs are random and usable only with a valid signed browser cookie.
-- Google access, refresh and ID tokens are never persisted.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
