CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  member_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  role_id text NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiration ON sessions(expires_at);
