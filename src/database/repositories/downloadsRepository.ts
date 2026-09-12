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
  error_message: string | null;
  created_at: string;
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
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  };
}

export class DownloadsRepository {
  constructor(private db: Database) {}

  public getAll(): DownloadItem[] {
    const stmt = this.db.prepare('SELECT * FROM downloads ORDER BY created_at DESC');
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public getById(id: string): DownloadItem | null {
    const stmt = this.db.prepare('SELECT * FROM downloads WHERE id = ?');
    const row = stmt.get(id) as DownloadRow | undefined;
    return row ? mapRowToDownload(row) : null;
  }

  public getActive(): DownloadItem[] {
    const stmt = this.db.prepare("SELECT * FROM downloads WHERE status IN ('QUEUED', 'DOWNLOADING') ORDER BY created_at ASC");
    const rows = stmt.all() as DownloadRow[];
    return rows.map(mapRowToDownload);
  }

  public upsert(item: DownloadItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO downloads (
        id, game_id, game_file_id, storage_account_id, status,
        total_bytes, downloaded_bytes, download_speed_bps,
        error_message, created_at, completed_at
      ) VALUES (
        @id, @gameId, @gameFileId, @storageAccountId, @status,
        @totalBytes, @downloadedBytes, @downloadSpeedBps,
        @errorMessage, @createdAt, @completedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total_bytes = excluded.total_bytes,
        downloaded_bytes = excluded.downloaded_bytes,
        download_speed_bps = excluded.download_speed_bps,
        error_message = excluded.error_message,
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
      errorMessage: item.errorMessage ?? null,
      createdAt: item.createdAt,
      completedAt: item.completedAt ?? null
    });
  }

  public updateProgress(id: string, downloadedBytes: number, speedBps: number): void {
    const stmt = this.db.prepare(`
      UPDATE downloads
      SET downloaded_bytes = ?, download_speed_bps = ?
      WHERE id = ?
    `);
    stmt.run(downloadedBytes, speedBps, id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM downloads WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
