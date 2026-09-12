import type { Database } from 'better-sqlite3';
import { StorageSyncState, SyncRun, SyncRunStatus } from '../../core/types';

interface SyncStateRow {
  storage_account_id: string;
  initial_scan_completed: number;
  start_page_token: string | null;
  next_change_page_token: string | null;
  last_full_scan_at: string | null;
  last_incremental_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncRunRow {
  id: string;
  storage_account_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  folders_scanned: number;
  files_scanned: number;
  games_detected: number;
  error_message: string | null;
  created_at: string;
}

function mapRowToState(row: SyncStateRow): StorageSyncState {
  return {
    storageAccountId: row.storage_account_id,
    initialScanCompleted: Boolean(row.initial_scan_completed),
    startPageToken: row.start_page_token ?? undefined,
    nextChangePageToken: row.next_change_page_token ?? undefined,
    lastFullScanAt: row.last_full_scan_at ?? undefined,
    lastIncrementalSyncAt: row.last_incremental_sync_at ?? undefined,
    lastError: row.last_error ?? undefined,
    updatedAt: row.updated_at
  };
}

function mapRowToRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    storageAccountId: row.storage_account_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    status: row.status as SyncRunStatus,
    foldersScanned: row.folders_scanned,
    filesScanned: row.files_scanned,
    gamesDetected: row.games_detected,
    errorMessage: row.error_message ?? undefined
  };
}

export class SyncStateRepository {
  constructor(private db: Database) {}

  public getSyncState(accountId: string): StorageSyncState | null {
    const stmt = this.db.prepare('SELECT * FROM storage_sync_state WHERE storage_account_id = ?');
    const row = stmt.get(accountId) as SyncStateRow | undefined;
    return row ? mapRowToState(row) : null;
  }

  public upsertSyncState(state: StorageSyncState): void {
    const stmt = this.db.prepare(
      `INSERT INTO storage_sync_state (
        storage_account_id, initial_scan_completed, start_page_token,
        next_change_page_token, last_full_scan_at, last_incremental_sync_at,
        last_error, updated_at
      ) VALUES (
        @accountId, @initialScanCompleted, @startPageToken,
        @nextChangePageToken, @lastFullScanAt, @lastIncrementalSyncAt,
        @lastError, @updatedAt
      )
      ON CONFLICT(storage_account_id) DO UPDATE SET
        initial_scan_completed = excluded.initial_scan_completed,
        start_page_token = COALESCE(excluded.start_page_token, storage_sync_state.start_page_token),
        next_change_page_token = COALESCE(excluded.next_change_page_token, storage_sync_state.next_change_page_token),
        last_full_scan_at = COALESCE(excluded.last_full_scan_at, storage_sync_state.last_full_scan_at),
        last_incremental_sync_at = COALESCE(excluded.last_incremental_sync_at, storage_sync_state.last_incremental_sync_at),
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`
    );

    stmt.run({
      accountId: state.storageAccountId,
      initialScanCompleted: state.initialScanCompleted ? 1 : 0,
      startPageToken: state.startPageToken ?? null,
      nextChangePageToken: state.nextChangePageToken ?? null,
      lastFullScanAt: state.lastFullScanAt ?? null,
      lastIncrementalSyncAt: state.lastIncrementalSyncAt ?? null,
      lastError: state.lastError ?? null,
      updatedAt: state.updatedAt || new Date().toISOString()
    });
  }

  public recordScanComplete(
    accountId: string,
    isFullScan: boolean,
    nextChangeToken?: string,
    error?: string
  ): void {
    const now = new Date().toISOString();
    const existing = this.getSyncState(accountId);

    this.upsertSyncState({
      storageAccountId: accountId,
      initialScanCompleted: isFullScan ? true : (existing?.initialScanCompleted ?? false),
      startPageToken: nextChangeToken || existing?.startPageToken,
      nextChangePageToken: nextChangeToken || existing?.nextChangePageToken,
      lastFullScanAt: isFullScan ? now : existing?.lastFullScanAt,
      lastIncrementalSyncAt: !isFullScan ? now : existing?.lastIncrementalSyncAt,
      lastError: error,
      updatedAt: now
    });
  }

  public createSyncRun(run: SyncRun): void {
    const stmt = this.db.prepare(
      `INSERT INTO sync_runs (
        id, storage_account_id, started_at, finished_at, status,
        folders_scanned, files_scanned, games_detected, error_message
      ) VALUES (
        @id, @storageAccountId, @startedAt, @finishedAt, @status,
        @foldersScanned, @filesScanned, @gamesDetected, @errorMessage
      )`
    );

    stmt.run({
      id: run.id,
      storageAccountId: run.storageAccountId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      status: run.status,
      foldersScanned: run.foldersScanned,
      filesScanned: run.filesScanned,
      gamesDetected: run.gamesDetected,
      errorMessage: run.errorMessage ?? null
    });
  }

  public updateSyncRun(id: string, updates: Partial<SyncRun>): void {
    const current = this.getSyncRunById(id);
    if (!current) return;

    const merged = { ...current, ...updates };
    const stmt = this.db.prepare(
      `UPDATE sync_runs
      SET finished_at = ?, status = ?, folders_scanned = ?, files_scanned = ?,
          games_detected = ?, error_message = ?
      WHERE id = ?`
    );

    stmt.run(
      merged.finishedAt ?? null,
      merged.status,
      merged.foldersScanned,
      merged.filesScanned,
      merged.gamesDetected,
      merged.errorMessage ?? null,
      id
    );
  }

  public getSyncRunById(id: string): SyncRun | null {
    const stmt = this.db.prepare('SELECT * FROM sync_runs WHERE id = ?');
    const row = stmt.get(id) as SyncRunRow | undefined;
    return row ? mapRowToRun(row) : null;
  }

  public getLatestSyncRun(accountId: string): SyncRun | null {
    const stmt = this.db.prepare(
      `SELECT * FROM sync_runs
      WHERE storage_account_id = ?
      ORDER BY started_at DESC
      LIMIT 1`
    );
    const row = stmt.get(accountId) as SyncRunRow | undefined;
    return row ? mapRowToRun(row) : null;
  }

  public getSyncRuns(accountId: string, limit = 10): SyncRun[] {
    const stmt = this.db.prepare(
      `SELECT * FROM sync_runs
      WHERE storage_account_id = ?
      ORDER BY started_at DESC
      LIMIT ?`
    );
    const rows = stmt.all(accountId, limit) as SyncRunRow[];
    return rows.map(mapRowToRun);
  }
}
