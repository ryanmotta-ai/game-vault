import type { Database } from 'better-sqlite3';
import { GameFile, GameFileStatus } from '../../core/types';

interface GameFileRow {
  id: string;
  game_id: string;
  storage_account_id: string;
  remote_file_id: string;
  remote_path: string;
  filename: string;
  size_bytes: number;
  md5_checksum: string | null;
  status: string;
  local_path: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToFile(row: GameFileRow): GameFile {
  return {
    id: row.id,
    gameId: row.game_id,
    storageAccountId: row.storage_account_id,
    remoteFileId: row.remote_file_id,
    remotePath: row.remote_path,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    md5Checksum: row.md5_checksum ?? undefined,
    status: row.status as GameFileStatus,
    localPath: row.local_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class GameFilesRepository {
  constructor(private db: Database) {}

  public getByGameId(gameId: string): GameFile[] {
    const stmt = this.db.prepare('SELECT * FROM game_files WHERE game_id = ? ORDER BY filename ASC');
    const rows = stmt.all(gameId) as GameFileRow[];
    return rows.map(mapRowToFile);
  }

  public getById(id: string): GameFile | null {
    const stmt = this.db.prepare('SELECT * FROM game_files WHERE id = ?');
    const row = stmt.get(id) as GameFileRow | undefined;
    return row ? mapRowToFile(row) : null;
  }

  public getByRemoteFileId(storageAccountId: string, remoteFileId: string): GameFile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM game_files
      WHERE storage_account_id = ? AND remote_file_id = ?
    `);
    const row = stmt.get(storageAccountId, remoteFileId) as GameFileRow | undefined;
    return row ? mapRowToFile(row) : null;
  }

  public getByStorageAccountId(storageAccountId: string): GameFile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM game_files
      WHERE storage_account_id = ?
      ORDER BY filename ASC
    `);
    const rows = stmt.all(storageAccountId) as GameFileRow[];
    return rows.map(mapRowToFile);
  }

  public updateRemotePath(id: string, remotePath: string, filename?: string): void {
    const stmt = this.db.prepare(`
      UPDATE game_files
      SET remote_path = ?, filename = COALESCE(?, filename), updated_at = ?
      WHERE id = ?
    `);
    stmt.run(remotePath, filename ?? null, new Date().toISOString(), id);
  }

  public updateSubtreePaths(storageAccountId: string, oldFolderPath: string, newFolderPath: string): number {
    const prefix = oldFolderPath.endsWith('/') ? oldFolderPath : `${oldFolderPath}/`;
    const newPrefix = newFolderPath.endsWith('/') ? newFolderPath : `${newFolderPath}/`;
    const prefixLen = prefix.length;

    const stmt = this.db.prepare(`
      UPDATE game_files
      SET remote_path = ? || SUBSTR(remote_path, ?),
          updated_at = ?
      WHERE storage_account_id = ? AND remote_path LIKE ? || '%'
    `);
    const now = new Date().toISOString();
    const res = stmt.run(newPrefix, prefixLen + 1, now, storageAccountId, prefix);
    return res.changes;
  }

  public updateStatusByRemoteFileId(storageAccountId: string, remoteFileId: string, status: GameFileStatus): boolean {
    const stmt = this.db.prepare(`
      UPDATE game_files
      SET status = ?, updated_at = ?
      WHERE storage_account_id = ? AND remote_file_id = ?
    `);
    const res = stmt.run(status, new Date().toISOString(), storageAccountId, remoteFileId);
    return res.changes > 0;
  }

  public upsert(file: GameFile): void {
    const stmt = this.db.prepare(`
      INSERT INTO game_files (
        id, game_id, storage_account_id, remote_file_id, remote_path,
        filename, size_bytes, md5_checksum, status, local_path,
        created_at, updated_at
      ) VALUES (
        @id, @gameId, @storageAccountId, @remoteFileId, @remotePath,
        @filename, @sizeBytes, @md5Checksum, @status, @localPath,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        remote_path = excluded.remote_path,
        filename = excluded.filename,
        size_bytes = excluded.size_bytes,
        md5_checksum = excluded.md5_checksum,
        status = excluded.status,
        local_path = excluded.local_path,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: file.id,
      gameId: file.gameId,
      storageAccountId: file.storageAccountId,
      remoteFileId: file.remoteFileId,
      remotePath: file.remotePath,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      md5Checksum: file.md5Checksum ?? null,
      status: file.status,
      localPath: file.localPath ?? null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    });
  }

  public updateStatus(id: string, status: GameFileStatus, localPath?: string): void {
    const stmt = this.db.prepare(`
      UPDATE game_files
      SET status = ?, local_path = COALESCE(?, local_path), updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, localPath ?? null, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM game_files WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
