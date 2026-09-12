import type { Database } from 'better-sqlite3';
import { logger } from '../core/logger';

export const INITIAL_SCHEMA_SQL = `
-- 1. Settings Table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Storage Accounts Table
CREATE TABLE IF NOT EXISTS storage_accounts (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_email TEXT,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DISCONNECTED', 'ERROR', 'REVOKED')),
  quota_total_bytes INTEGER NOT NULL DEFAULT 0,
  quota_used_bytes INTEGER NOT NULL DEFAULT 0,
  auth_config_secure_ref TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Games Table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  cover_url TEXT,
  banner_url TEXT,
  platform TEXT NOT NULL,
  release_year INTEGER,
  developer TEXT,
  publisher TEXT,
  state TEXT NOT NULL CHECK(state IN ('CLOUD', 'DOWNLOADING', 'READY')),
  size_bytes INTEGER NOT NULL DEFAULT 0,
  installed_path TEXT,
  play_time_seconds INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_state ON games(state);
CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);

-- 4. Game Files Table
CREATE TABLE IF NOT EXISTS game_files (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  storage_account_id TEXT NOT NULL REFERENCES storage_accounts(id) ON DELETE RESTRICT,
  remote_file_id TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  md5_checksum TEXT,
  status TEXT NOT NULL CHECK(status IN ('REMOTE', 'DOWNLOADING', 'CACHED_LOCAL')),
  local_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_files_game_id ON game_files(game_id);
CREATE INDEX IF NOT EXISTS idx_game_files_account_id ON game_files(storage_account_id);

-- 5. Downloads Queue Table
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_file_id TEXT REFERENCES game_files(id) ON DELETE CASCADE,
  storage_account_id TEXT NOT NULL REFERENCES storage_accounts(id),
  status TEXT NOT NULL CHECK(status IN ('QUEUED', 'DOWNLOADING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  total_bytes INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  download_speed_bps INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

-- 6. Emulators Configuration Table
CREATE TABLE IF NOT EXISTS emulators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  default_args TEXT,
  config_path TEXT,
  is_installed INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initializeDatabaseSchema(db: Database): void {
  const log = logger.child('Schema');
  log.info('Running database schema migrations...');

  db.exec(INITIAL_SCHEMA_SQL);

  log.info('Database schema migration completed successfully.');
}
