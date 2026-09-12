import type { Database } from 'better-sqlite3';
import { logger } from '../core/logger';
import { MigrationRunner, Migration } from './migrations/migrationRunner';

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    up: (db: Database) => {
      db.exec(`
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
          status TEXT NOT NULL CHECK(status IN ('REMOTE', 'DOWNLOADING', 'CACHED_LOCAL', 'MISSING')),
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
      `);
    }
  },
  {
    version: 2,
    name: '002_storage_accounts_v2',
    up: (db: Database) => {
      // Check existing columns
      const cols = db.prepare("PRAGMA table_info('storage_accounts')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('provider_account_id')) {
        db.exec("ALTER TABLE storage_accounts ADD COLUMN provider_account_id TEXT NOT NULL DEFAULT '';");
      }

      if (!colNames.has('credential_key')) {
        db.exec("ALTER TABLE storage_accounts ADD COLUMN credential_key TEXT NOT NULL DEFAULT '';");
      }

      if (!colNames.has('last_authenticated_at')) {
        db.exec('ALTER TABLE storage_accounts ADD COLUMN last_authenticated_at TEXT;');
      }

      // Migrate existing auth_config_secure_ref to credential_key if present
      if (colNames.has('auth_config_secure_ref')) {
        db.exec(`
          UPDATE storage_accounts
          SET credential_key = auth_config_secure_ref
          WHERE (credential_key = '' OR credential_key IS NULL)
            AND auth_config_secure_ref IS NOT NULL;
        `);
      }

      // Set fallback provider_account_id for existing mock records
      db.exec(`
        UPDATE storage_accounts
        SET provider_account_id = id
        WHERE provider_account_id = '' OR provider_account_id IS NULL;
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_storage_accounts_provider_acc
        ON storage_accounts(provider_type, provider_account_id);
      `);
    }
  },
  {
    version: 3,
    name: '003_cloud_inventory',
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cloud_files (
          id TEXT PRIMARY KEY,
          storage_account_id TEXT NOT NULL REFERENCES storage_accounts(id) ON DELETE CASCADE,
          remote_file_id TEXT NOT NULL,
          name TEXT NOT NULL,
          extension TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          md5_checksum TEXT,
          parent_remote_id TEXT,
          remote_path TEXT NOT NULL,
          modified_time TEXT,
          is_folder INTEGER NOT NULL DEFAULT 0,
          is_shortcut INTEGER NOT NULL DEFAULT 0,
          trashed INTEGER NOT NULL DEFAULT 0,
          classification TEXT NOT NULL DEFAULT 'UNKNOWN',
          detected_platform TEXT,
          classification_confidence REAL NOT NULL DEFAULT 0.0,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(storage_account_id, remote_file_id)
        );

        CREATE INDEX IF NOT EXISTS idx_cloud_files_account_parent
        ON cloud_files(storage_account_id, parent_remote_id);

        CREATE INDEX IF NOT EXISTS idx_cloud_files_account_path
        ON cloud_files(storage_account_id, remote_path);

        CREATE INDEX IF NOT EXISTS idx_cloud_files_classification
        ON cloud_files(classification);
      `);
    }
  },
  {
    version: 4,
    name: '004_storage_sync_state',
    up: (db: Database) => {
      // Deduplicate any rows on (provider_type, provider_account_id) before unique index
      db.exec(`
        DELETE FROM storage_accounts
        WHERE rowid NOT IN (
          SELECT MIN(rowid)
          FROM storage_accounts
          GROUP BY provider_type, provider_account_id
        );
      `);

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_accounts_provider_unique
        ON storage_accounts(provider_type, provider_account_id);

        CREATE TABLE IF NOT EXISTS storage_sync_state (
          storage_account_id TEXT PRIMARY KEY REFERENCES storage_accounts(id) ON DELETE CASCADE,
          initial_scan_completed INTEGER NOT NULL DEFAULT 0,
          start_page_token TEXT,
          next_change_page_token TEXT,
          last_full_scan_at TEXT,
          last_incremental_sync_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
          id TEXT PRIMARY KEY,
          storage_account_id TEXT NOT NULL REFERENCES storage_accounts(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('STARTED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED')),
          folders_scanned INTEGER NOT NULL DEFAULT 0,
          files_scanned INTEGER NOT NULL DEFAULT 0,
          games_detected INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sync_runs_account
        ON sync_runs(storage_account_id);

        CREATE INDEX IF NOT EXISTS idx_sync_runs_status
        ON sync_runs(status);

        -- Upgrade game_files status CHECK constraint to support 'MISSING'
        CREATE TABLE IF NOT EXISTS game_files_new (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          storage_account_id TEXT NOT NULL REFERENCES storage_accounts(id) ON DELETE RESTRICT,
          remote_file_id TEXT NOT NULL,
          remote_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          md5_checksum TEXT,
          status TEXT NOT NULL CHECK(status IN ('REMOTE', 'DOWNLOADING', 'CACHED_LOCAL', 'MISSING')),
          local_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO game_files_new SELECT * FROM game_files;
        DROP TABLE game_files;
        ALTER TABLE game_files_new RENAME TO game_files;
        CREATE INDEX IF NOT EXISTS idx_game_files_game_id ON game_files(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_files_account_id ON game_files(storage_account_id);
      `);
    }
  }
];

export function initializeDatabaseSchema(db: Database): void {
  const log = logger.child('Schema');
  log.info('Running database schema migrations via MigrationRunner...');

  const runner = new MigrationRunner(db);
  runner.runMigrations(MIGRATIONS);

  log.info('All database schema migrations applied successfully.');
}
