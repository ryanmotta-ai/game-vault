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
<<<<<<< Updated upstream
=======
  },
  {
    version: 5,
    name: '005_sync_correctness',
    up: (db: Database) => {
      const cols = db.prepare("PRAGMA table_info('cloud_files')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('last_seen_run_id')) {
        db.exec('ALTER TABLE cloud_files ADD COLUMN last_seen_run_id TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cloud_files_run_seen
        ON cloud_files(storage_account_id, last_seen_run_id, trashed);
      `);
    }
  },
  {
    version: 6,
    name: '006_downloads_v1',
    up: (db: Database) => {
      const cols = db.prepare("PRAGMA table_info('downloads')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('destination_path')) {
        db.exec('ALTER TABLE downloads ADD COLUMN destination_path TEXT;');
      }
      if (!colNames.has('partial_path')) {
        db.exec('ALTER TABLE downloads ADD COLUMN partial_path TEXT;');
      }
      if (!colNames.has('started_at')) {
        db.exec('ALTER TABLE downloads ADD COLUMN started_at TEXT;');
      }
      if (!colNames.has('updated_at')) {
        db.exec('ALTER TABLE downloads ADD COLUMN updated_at TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_downloads_game_id ON downloads(game_id);
        CREATE INDEX IF NOT EXISTS idx_downloads_game_file_id ON downloads(game_file_id);
      `);
    }
  },
  {
    version: 7,
    name: '007_downloads_v2',
    up: (db: Database) => {
      const cols = db.prepare("PRAGMA table_info('downloads')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('priority')) {
        db.exec('ALTER TABLE downloads ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;');
      }
      if (!colNames.has('retry_count')) {
        db.exec('ALTER TABLE downloads ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;');
      }
      if (!colNames.has('last_error_code')) {
        db.exec('ALTER TABLE downloads ADD COLUMN last_error_code TEXT;');
      }
      if (!colNames.has('resume_supported')) {
        db.exec('ALTER TABLE downloads ADD COLUMN resume_supported INTEGER NOT NULL DEFAULT 1;');
      }
      if (!colNames.has('remote_modified_time')) {
        db.exec('ALTER TABLE downloads ADD COLUMN remote_modified_time TEXT;');
      }
      if (!colNames.has('remote_etag')) {
        db.exec('ALTER TABLE downloads ADD COLUMN remote_etag TEXT;');
      }
      if (!colNames.has('remote_md5')) {
        db.exec('ALTER TABLE downloads ADD COLUMN remote_md5 TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_downloads_priority_created ON downloads(priority DESC, created_at ASC);
      `);
    }
  },
  {
    version: 8,
    name: '008_preparation_and_cache',
    up: (db: Database) => {
      // 1. Rebuild games table to allow 'QUEUED', 'PREPARING', 'ERROR' and add pinned, last_accessed_at
      db.exec(`
        CREATE TABLE IF NOT EXISTS games_new (
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
          state TEXT NOT NULL CHECK(state IN ('CLOUD', 'QUEUED', 'DOWNLOADING', 'PREPARING', 'READY', 'ERROR')),
          size_bytes INTEGER NOT NULL DEFAULT 0,
          installed_path TEXT,
          play_time_seconds INTEGER NOT NULL DEFAULT 0,
          last_played_at TEXT,
          last_accessed_at TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO games_new (
          id, title, slug, description, cover_url, banner_url, platform,
          release_year, developer, publisher, state, size_bytes,
          installed_path, play_time_seconds, last_played_at, created_at, updated_at
        ) SELECT id, title, slug, description, cover_url, banner_url, platform,
          release_year, developer, publisher, state, size_bytes,
          installed_path, play_time_seconds, last_played_at, created_at, updated_at
        FROM games;

        DROP TABLE games;
        ALTER TABLE games_new RENAME TO games;

        CREATE INDEX IF NOT EXISTS idx_games_state ON games(state);
        CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);
        CREATE INDEX IF NOT EXISTS idx_games_pinned ON games(pinned);
      `);

      // 2. Create preparation_jobs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS preparation_jobs (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('QUEUED', 'EXTRACTING', 'VALIDATING', 'FINALIZING', 'COMPLETED', 'FAILED', 'CANCELLED')),
          step TEXT,
          progress_percentage REAL NOT NULL DEFAULT 0.0,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          processed_bytes INTEGER NOT NULL DEFAULT 0,
          temp_dir TEXT,
          destination_dir TEXT,
          primary_file_path TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_preparation_jobs_game_id ON preparation_jobs(game_id);
        CREATE INDEX IF NOT EXISTS idx_preparation_jobs_status ON preparation_jobs(status);
      `);

      // 3. Create game_manifests table
      db.exec(`
        CREATE TABLE IF NOT EXISTS game_manifests (
          game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          platform TEXT NOT NULL,
          prepared_at TEXT NOT NULL,
          primary_executable_or_rom TEXT NOT NULL,
          total_local_size INTEGER NOT NULL DEFAULT 0,
          install_required INTEGER NOT NULL DEFAULT 0,
          files_json TEXT NOT NULL,
          source_artifact_ids_json TEXT,
          integrity_status TEXT NOT NULL CHECK(integrity_status IN ('VERIFIED', 'UNVERIFIED', 'CORRUPTED')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 4. Default settings for Phase 3C
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('cache_max_bytes', '536870912000', ?)
      `).run(now);

      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('keep_original_archives', 'false', ?)
      `).run(now);
    }
  },
  {
    version: 9,
    name: '009_launcher_and_emulators',
    up: (db: Database) => {
      // 1. Upgrade emulators table with Phase 4A columns
      const cols = db.prepare("PRAGMA table_info('emulators')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('adapter_type')) {
        db.exec("ALTER TABLE emulators ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'custom';");
      }
      if (!colNames.has('supported_platforms_json')) {
        db.exec("ALTER TABLE emulators ADD COLUMN supported_platforms_json TEXT NOT NULL DEFAULT '[]';");
      }
      if (!colNames.has('fullscreen_args')) {
        db.exec('ALTER TABLE emulators ADD COLUMN fullscreen_args TEXT;');
      }
      if (!colNames.has('working_directory')) {
        db.exec('ALTER TABLE emulators ADD COLUMN working_directory TEXT;');
      }
      if (!colNames.has('detected')) {
        db.exec('ALTER TABLE emulators ADD COLUMN detected INTEGER NOT NULL DEFAULT 0;');
      }
      if (!colNames.has('enabled')) {
        db.exec('ALTER TABLE emulators ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;');
      }

      // Populate existing rows if any
      const existingRows = db.prepare('SELECT id, name, platform, is_installed FROM emulators').all() as Array<{
        id: string;
        name: string;
        platform: string;
        is_installed: number;
      }>;

      for (const row of existingRows) {
        let adapterType = 'custom';
        const nameLower = (row.name || '').toLowerCase();
        if (nameLower.includes('pcsx2')) adapterType = 'pcsx2';
        else if (nameLower.includes('dolphin')) adapterType = 'dolphin';
        else if (nameLower.includes('duckstation')) adapterType = 'duckstation';
        else if (nameLower.includes('ppsspp')) adapterType = 'ppsspp';
        else if (nameLower.includes('retroarch')) adapterType = 'retroarch';

        const platforms = row.platform ? [row.platform] : [];
        db.prepare(`
          UPDATE emulators
          SET adapter_type = ?,
              supported_platforms_json = ?,
              detected = ?,
              enabled = 1
          WHERE id = ?
        `).run(adapterType, JSON.stringify(platforms), row.is_installed ? 1 : 0, row.id);
      }

      // 2. Create launch_profiles table
      db.exec(`
        CREATE TABLE IF NOT EXISTS launch_profiles (
          id TEXT PRIMARY KEY,
          game_id TEXT UNIQUE NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          launcher_type TEXT NOT NULL CHECK(launcher_type IN ('emulator', 'native_pc')),
          emulator_id TEXT REFERENCES emulators(id) ON DELETE SET NULL,
          executable_path TEXT,
          arguments_template TEXT,
          working_directory TEXT,
          fullscreen INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_launch_profiles_game_id ON launch_profiles(game_id);
      `);

      // 3. Create game_sessions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS game_sessions (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          launcher_type TEXT NOT NULL CHECK(launcher_type IN ('emulator', 'native_pc')),
          emulator_id TEXT REFERENCES emulators(id) ON DELETE SET NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          exit_code INTEGER,
          crashed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_game_sessions_game_id ON game_sessions(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_started_at ON game_sessions(started_at);
      `);

      // 4. Default settings for Phase 4A
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('launcher_fullscreen_default', 'true', ?)
      `).run(now);

      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('retroarch_cores_dir', '', ?)
      `).run(now);
    }
  },
  {
    version: 10,
    name: '010_instant_play_and_streaming',
    up: (db: Database) => {
      // 1. Add playback_mode to launch_profiles table if not exists
      const profileCols = db.prepare(`PRAGMA table_info(launch_profiles)`).all() as Array<{ name: string }>;
      if (!profileCols.some((col) => col.name === 'playback_mode')) {
        db.exec(`ALTER TABLE launch_profiles ADD COLUMN playback_mode TEXT DEFAULT 'auto'`);
      }

      // 2. Default settings for Phase 4C
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('streaming_cache_max_bytes', '53687091200', ?)
      `).run(now);

      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('instant_hydration_max_size_mb', '128', ?)
      `).run(now);

      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('finish_caching_streamed_games', 'true', ?)
      `).run(now);

      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('streaming_read_ahead_blocks', '2', ?)
      `).run(now);
    }
  },
  {
    version: 11,
    name: '011_integration_connections',
    up: (db: Database) => {
      // 1. Create integration_connections table
      db.exec(`
        CREATE TABLE IF NOT EXISTS integration_connections (
          id TEXT PRIMARY KEY,
          integration_id TEXT NOT NULL,
          external_account_id TEXT,
          display_name TEXT NOT NULL,
          account_label TEXT,
          status TEXT NOT NULL CHECK(status IN ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'AUTH_EXPIRED', 'DISABLED')),
          credential_key TEXT,
          config_json TEXT,
          connected_at TEXT,
          last_validated_at TEXT,
          last_used_at TEXT,
          last_error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_connections_unique_account
          ON integration_connections(integration_id, external_account_id)
          WHERE external_account_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_integration_connections_integration_id
          ON integration_connections(integration_id);

        CREATE INDEX IF NOT EXISTS idx_integration_connections_status
          ON integration_connections(status);
      `);

      // 2. Non-destructive reconciliation from existing storage_accounts
      try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_accounts'").get();
        if (tableCheck) {
          const rows = db.prepare("SELECT * FROM storage_accounts").all() as Array<any>;
          const now = new Date().toISOString();
          const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO integration_connections (
              id, integration_id, external_account_id, display_name, account_label,
              status, credential_key, config_json, connected_at, last_validated_at,
              created_at, updated_at
            ) VALUES (
              @id, @integrationId, @externalAccountId, @displayName, @accountLabel,
              @status, @credentialKey, @configJson, @connectedAt, @lastValidatedAt,
              @createdAt, @updatedAt
            )
          `);

          for (const row of rows) {
            let integrationId = '';
            const pType = (row.provider_type || '').toLowerCase();
            if (pType === 'google_drive' || pType === 'gdrive') {
              integrationId = 'google-drive';
            } else if (pType === 'local') {
              integrationId = 'local-storage';
            }
            if (!integrationId) continue;

            let status = 'DISCONNECTED';
            if (row.status === 'ACTIVE') status = 'CONNECTED';
            else if (row.status === 'ERROR') status = 'ERROR';

            insertStmt.run({
              id: row.id,
              integrationId,
              externalAccountId: row.provider_account_id || row.id,
              displayName: row.account_name || 'Google Drive',
              accountLabel: row.account_email || null,
              status,
              credentialKey: row.credential_key || `google_drive:${row.id}`,
              configJson: JSON.stringify({
                storageAccountId: row.id,
                email: row.account_email,
                quotaTotalBytes: row.quota_total_bytes,
                quotaUsedBytes: row.quota_used_bytes
              }),
              connectedAt: row.last_authenticated_at || row.created_at || now,
              lastValidatedAt: row.last_authenticated_at || row.updated_at || now,
              createdAt: row.created_at || now,
              updatedAt: row.updated_at || now
            });
          }
        }
      } catch {
        // Safe fallback - avoid failing migration on optional reconciliation
      }
    }
  },
  {
    version: 12,
    name: '012_game_metadata_and_artwork',
    up: (db: Database) => {
      const cols = db.prepare("PRAGMA table_info('games')").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has('genres')) {
        db.exec('ALTER TABLE games ADD COLUMN genres TEXT;');
      }
      if (!colNames.has('rating')) {
        db.exec('ALTER TABLE games ADD COLUMN rating REAL;');
      }
      if (!colNames.has('screenshot_urls')) {
        db.exec('ALTER TABLE games ADD COLUMN screenshot_urls TEXT;');
      }
      if (!colNames.has('local_cover_path')) {
        db.exec('ALTER TABLE games ADD COLUMN local_cover_path TEXT;');
      }
      if (!colNames.has('local_banner_path')) {
        db.exec('ALTER TABLE games ADD COLUMN local_banner_path TEXT;');
      }
      if (!colNames.has('local_screenshot_paths')) {
        db.exec('ALTER TABLE games ADD COLUMN local_screenshot_paths TEXT;');
      }
      if (!colNames.has('metadata_source')) {
        db.exec('ALTER TABLE games ADD COLUMN metadata_source TEXT;');
      }
      if (!colNames.has('metadata_scraped_at')) {
        db.exec('ALTER TABLE games ADD COLUMN metadata_scraped_at TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_games_metadata_scraped ON games(metadata_scraped_at);
        CREATE INDEX IF NOT EXISTS idx_games_rating ON games(rating);
      `);
    }
  },
  {
    version: 13,
    name: '013_metadata_pipeline',
    up: (db: Database) => {
      db.exec(`
        -- 1. Game Metadata Entity
        CREATE TABLE IF NOT EXISTS game_metadata (
          game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          canonical_title TEXT,
          sort_title TEXT,
          description TEXT,
          release_date TEXT,
          release_year INTEGER,
          developer TEXT,
          publisher TEXT,
          genres_json TEXT,
          players TEXT,
          rating REAL,
          region TEXT,
          language TEXT,
          source_summary TEXT,
          user_override_flags TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_game_metadata_release_year ON game_metadata(release_year);
        CREATE INDEX IF NOT EXISTS idx_game_metadata_developer ON game_metadata(developer);

        -- 2. Game Metadata Provider Sources
        CREATE TABLE IF NOT EXISTS game_metadata_sources (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          provider_game_id TEXT NOT NULL,
          connection_id TEXT,
          confidence TEXT NOT NULL CHECK(confidence IN ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS')),
          match_signals_json TEXT,
          matched_at TEXT NOT NULL,
          last_synced_at TEXT,
          source_data_hash TEXT,
          status TEXT NOT NULL CHECK(status IN ('MATCHED', 'REVIEW_REQUIRED', 'SKIPPED', 'REJECTED', 'USER_CONFIRMED')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(game_id, provider_id)
        );

        CREATE INDEX IF NOT EXISTS idx_game_metadata_sources_game ON game_metadata_sources(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_metadata_sources_status ON game_metadata_sources(status);

        -- 3. Game Artwork Entity
        CREATE TABLE IF NOT EXISTS game_artwork (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('COVER_FRONT', 'COVER_BACK', 'BOX_3D', 'LOGO', 'BACKGROUND', 'SCREENSHOT', 'TITLE_SCREEN', 'FANART', 'ICON', 'VIDEO', 'MANUAL')),
          provider TEXT NOT NULL,
          provider_media_id TEXT,
          source_url TEXT,
          local_path TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          mime_type TEXT,
          file_size INTEGER,
          checksum TEXT,
          is_primary INTEGER NOT NULL DEFAULT 0,
          is_user_custom INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('CACHED', 'MISSING', 'PENDING')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_game_artwork_game_type ON game_artwork(game_id, type);
        CREATE INDEX IF NOT EXISTS idx_game_artwork_primary ON game_artwork(game_id, is_primary);

        -- 4. Metadata Background Jobs Queue
        CREATE TABLE IF NOT EXISTS metadata_jobs (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('QUEUED', 'SEARCHING', 'MATCHED', 'DOWNLOADING_MEDIA', 'COMPLETED', 'REVIEW_REQUIRED', 'FAILED', 'CANCELLED', 'SKIPPED')),
          provider_id TEXT,
          confidence TEXT,
          priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('USER_REQUESTED', 'NORMAL', 'BACKGROUND')),
          error_message TEXT,
          started_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_metadata_jobs_status ON metadata_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_metadata_jobs_priority ON metadata_jobs(priority);
      `);

      // Insert default metadata configuration settings with updated_at timestamp
      const now = new Date().toISOString();
      const settingsToSeed = [
        ['metadata_preferred_provider', 'auto'],
        ['metadata_preferred_language', 'pt-BR'],
        ['metadata_preferred_region', 'auto'],
        ['metadata_auto_enrich', 'true'],
        ['metadata_download_covers', 'true'],
        ['metadata_download_logos', 'true'],
        ['metadata_download_backgrounds', 'true'],
        ['metadata_download_screenshots', 'true'],
        ['metadata_concurrency', '2']
      ];
      const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
      for (const [k, v] of settingsToSeed) {
        insertStmt.run(k, v, now);
      }
    }
>>>>>>> Stashed changes
  }
];

export function initializeDatabaseSchema(db: Database): void {
  const log = logger.child('Schema');
  log.info('Running database schema migrations via MigrationRunner...');

  const runner = new MigrationRunner(db);
  runner.runMigrations(MIGRATIONS);

  log.info('All database schema migrations applied successfully.');
}
