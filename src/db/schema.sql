-- Shared schema for Cloudflare D1 and local SQLite (sql.js)
-- Apply to D1:
--   npx wrangler d1 execute procurecorp-db --file=./src/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee', 'guest')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  category TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')) DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  supplier TEXT,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);

-- Seed users after deploy via POST /auth/register or localStore first-run seed.
-- Example (compute SHA-256 of password in Worker or Node):
-- INSERT INTO users (id, username, password_hash, name, email, role) VALUES
--   ('1', 'admin', '<sha256 of admin123>', 'Alex Rivera', 'alex.rivera@procurecorp.com', 'admin');
