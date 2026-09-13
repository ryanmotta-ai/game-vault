import type { Database } from 'better-sqlite3';
import { DownloadItem, DownloadStatus } from '../../core/types';

interface DownloadRow {
  id: string;
  game_id: string;
  game_file_id: string | null;
  storage_account_id: string;
  status: string;
  total_bytes: number;
  downloaded_bytes: number;
  download_speed_bps: number;
  destination_path: string | null;
  partial_path: string | null;
  error_message: string | null;
  priority: number;
  retry_count: number;
  last_error_code: string | null;
  resume_supported: number;
  remote_modified_time: string | null;
  remote_etag: string | null;
  remote_md5: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

function mapRowToDownload(row: DownloadRow): DownloadItem {
  return {
    id: row.id,
    gameId: row.game_id,
    gameFileId: row.game_file_id ?? undefined,
    storageAccountId: row.storage_account_id,
    status: row.status as DownloadStatus,
    totalBytes: row.total_bytes,
    downloadedBytes: row.downloaded_bytes,
    downloadSpeedBps: row.download_speed_bps,
    destinationPath: row.destination_path ?? undefined,
    partialPath: row.partial_path ?? undefined,
    errorMessage: row.error_message ?? undefined,
    priority: row.priority ?? 0,
    retryCount: row.retry_count ?? 0,
    lastErrorCode: row.last_error_code ?? undefined,
    resumeSupported: row.resume_supported !== 0,
    remoteModifiedTime: row.remote_modified_time ?? undefined,
    remoteEtag: row.remote_etag ?? undefined,
    remoteMd5: row.remote_md5 ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

export class DownloadsRepository {
  constructor(private db: Database) {}

  public getAll(): DownloadItem[] {
    const stmt = this.db.prepare('SELECT * FROM downloads ORDER BY priority DESC, created_at DESC');
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public getById(id: string): DownloadItem | null {
    const stmt = this.db.prepare('SELECT * FROM downloads WHERE id = ?');
    const row = stmt.get(id) as DownloadRow | undefined;
    return row ? mapRowToDownload(row) : null;
  }

  public getActive(): DownloadItem[] {
    const stmt = this.db.prepare(
      "SELECT * FROM downloads WHERE status IN ('QUEUED', 'DOWNLOADING') ORDER BY priority DESC, created_at ASC"
    );
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public getPaused(): DownloadItem[] {
    const stmt = this.db.prepare(
      "SELECT * FROM downloads WHERE status = 'PAUSED' ORDER BY priority DESC, created_at ASC"
    );
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public getActiveByGameId(gameId: string): DownloadItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM downloads
      WHERE game_id = ? AND status IN ('QUEUED', 'DOWNLOADING', 'PAUSED')
      ORDER BY priority DESC, created_at ASC LIMIT 1
    `);
    const row = stmt.get(gameId) as DownloadRow | undefined;
    return row ? mapRowToDownload(row) : null;
  }

  public getActiveByGameFileId(gameFileId: string): DownloadItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM downloads
      WHERE game_file_id = ? AND status IN ('QUEUED', 'DOWNLOADING', 'PAUSED')
      ORDER BY priority DESC, created_at ASC LIMIT 1
    `);
    const row = stmt.get(gameFileId) as DownloadRow | undefined;
    return row ? mapRowToDownload(row) : null;
  }

  public getNextQueued(): DownloadItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM downloads
      WHERE status = 'QUEUED'
      ORDER BY priority DESC, created_at ASC LIMIT 1
    `);
    const row = stmt.get() as DownloadRow | undefined;
    return row ? mapRowToDownload(row) : null;
  }

  public getStaleDownloading(): DownloadItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM downloads
      WHERE status = 'DOWNLOADING'
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public getMaxPriority(): number {
    const stmt = this.db.prepare('SELECT MAX(priority) as max_p FROM downloads');
    const row = stmt.get() as { max_p: number | null } | undefined;
    return row?.max_p ?? 0;
  }

  public updatePriority(id: string, priority: number): void {
    const stmt = this.db.prepare(`
      UPDATE downloads SET priority = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(priority, new Date().toISOString(), id);
  }

  public updateRetry(id: string, retryCount: number, lastErrorCode?: string): void {
    const stmt = this.db.prepare(`
      UPDATE downloads SET retry_count = ?, last_error_code = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(retryCount, lastErrorCode ?? null, new Date().toISOString(), id);
  }

  public clearCompleted(): number {
    const stmt = this.db.prepare("DELETE FROM downloads WHERE status IN ('COMPLETED', 'CANCELLED')");
    const res = stmt.run();
    return res.changes;
  }

  public upsert(item: DownloadItem): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO downloads (
        id, game_id, game_file_id, storage_account_id, status,
        total_bytes, downloaded_bytes, download_speed_bps,
        destination_path, partial_path, error_message,
        priority, retry_count, last_error_code, resume_supported,
        remote_modified_time, remote_etag, remote_md5,
        created_at, started_at, updated_at, completed_at
      ) VALUES (
        @id, @gameId, @gameFileId, @storageAccountId, @status,
        @totalBytes, @downloadedBytes, @downloadSpeedBps,
        @destinationPath, @partialPath, @errorMessage,
        @priority, @retryCount, @lastErrorCode, @resumeSupported,
        @remoteModifiedTime, @remoteEtag, @remoteMd5,
        @createdAt, @startedAt, @updatedAt, @completedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total_bytes = excluded.total_bytes,
        downloaded_bytes = excluded.downloaded_bytes,
        download_speed_bps = excluded.download_speed_bps,
        destination_path = COALESCE(excluded.destination_path, downloads.destination_path),
        partial_path = COALESCE(excluded.partial_path, downloads.partial_path),
        error_message = excluded.error_message,
        priority = excluded.priority,
        retry_count = excluded.retry_count,
        last_error_code = excluded.last_error_code,
        resume_supported = excluded.resume_supported,
        remote_modified_time = COALESCE(excluded.remote_modified_time, downloads.remote_modified_time),
        remote_etag = COALESCE(excluded.remote_etag, downloads.remote_etag),
        remote_md5 = COALESCE(excluded.remote_md5, downloads.remote_md5),
        started_at = COALESCE(excluded.started_at, downloads.started_at),
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `);

    stmt.run({
      id: item.id,
      gameId: item.gameId,
      gameFileId: item.gameFileId ?? null,
      storageAccountId: item.storageAccountId,
      status: item.status,
      totalBytes: item.totalBytes,
      downloadedBytes: item.downloadedBytes,
      downloadSpeedBps: item.downloadSpeedBps,
      destinationPath: item.destinationPath ?? null,
      partialPath: item.partialPath ?? null,
      errorMessage: item.errorMessage ?? null,
      priority: item.priority ?? 0,
      retryCount: item.retryCount ?? 0,
      lastErrorCode: item.lastErrorCode ?? null,
      resumeSupported: item.resumeSupported === false ? 0 : 1,
      remoteModifiedTime: item.remoteModifiedTime ?? null,
      remoteEtag: item.remoteEtag ?? null,
      remoteMd5: item.remoteMd5 ?? null,
      createdAt: item.createdAt,
      startedAt: item.startedAt ?? null,
      updatedAt: item.updatedAt ?? now,
      completedAt: item.completedAt ?? null
    });
  }

  public updateProgress(id: string, downloadedBytes: number, speedBps: number): void {
    const stmt = this.db.prepare(`
      UPDATE downloads
      SET downloaded_bytes = ?, download_speed_bps = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(downloadedBytes, speedBps, new Date().toISOString(), id);
  }

  public updateStatus(
    id: string,
    status: DownloadStatus,
    errorMessage?: string,
    completedAt?: string,
    lastErrorCode?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE downloads
      SET status = ?, error_message = ?, completed_at = ?, last_error_code = COALESCE(?, last_error_code), updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, errorMessage ?? null, completedAt ?? null, lastErrorCode ?? null, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM downloads WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
