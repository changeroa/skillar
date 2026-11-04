-- MCP authorization is separate from Google sessions and connector ingest tokens.
-- The primary row is checked even if an OAuth KV replica retains a revoked token.
CREATE TABLE mcp_connections (
  connection_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  auth_generation INTEGER NOT NULL CHECK (auth_generation > 0),
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('oauth', 'pat')),
  name TEXT NOT NULL,
  client_id TEXT,
  oauth_grant_id TEXT UNIQUE,
  oauth_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (oauth_cleanup_pending IN (0, 1)),
  token_hash TEXT UNIQUE,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  record_activity INTEGER NOT NULL DEFAULT 0 CHECK (record_activity IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (account_id, device_id) REFERENCES devices(account_id, device_id),
  CHECK (
    (kind = 'oauth' AND client_id IS NOT NULL AND token_hash IS NULL) OR
    (kind = 'pat' AND client_id IS NULL AND token_hash IS NOT NULL)
  )
);
CREATE INDEX mcp_connections_account ON mcp_connections(account_id, created_at);
CREATE INDEX mcp_connections_expiry ON mcp_connections(expires_at);

-- OAuth values are never stored here. Primary hash rows fence KV-stale tokens,
-- including individually revoked access tokens and rotated refresh credentials.
CREATE TABLE mcp_credentials (
  token_hash TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES mcp_connections(connection_id),
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX mcp_credentials_connection ON mcp_credentials(connection_id);
CREATE INDEX mcp_credentials_expiry ON mcp_credentials(expires_at);

-- Consent handles are bound to the same still-live Google account and session.
-- Only the handle hash is stored here; the OAuth library owns its request data.
CREATE TABLE mcp_consents (
  handle_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  auth_generation INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  expires_at INTEGER NOT NULL
);
CREATE INDEX mcp_consents_expiry ON mcp_consents(expires_at);

-- Keep long OAuth return URLs out of the signed Google flow cookie.
CREATE TABLE google_login_returns (
  state_hash TEXT PRIMARY KEY,
  return_path TEXT NOT NULL CHECK (length(return_path) <= 8192),
  expires_at INTEGER NOT NULL
);
CREATE INDEX google_login_returns_expiry ON google_login_returns(expires_at);
