-- Expand existing Google users/sessions without changing their auth contract.
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL UNIQUE REFERENCES users(sub) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  auth_generation INTEGER NOT NULL DEFAULT 1 CHECK (auth_generation > 0),
  shard_id TEXT NOT NULL DEFAULT 'activity-00' CHECK (shard_id = 'activity-00')
);
CREATE TABLE devices (
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (account_id, device_id)
);
CREATE TABLE api_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  auth_generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (account_id, device_id) REFERENCES devices(account_id, device_id)
);
CREATE INDEX api_tokens_device ON api_tokens(account_id, device_id);
CREATE TABLE device_grants (
  grant_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL,
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  auth_generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (account_id, device_id) REFERENCES devices(account_id, device_id)
);
CREATE INDEX device_grants_expiry ON device_grants(expires_at);
