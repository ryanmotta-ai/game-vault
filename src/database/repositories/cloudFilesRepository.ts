import type { Database } from 'better-sqlite3';
import { CloudFile, CloudFileClassification, GamePlatform } from '../../core/types';

interface CloudFileRow {
  id: string;
  storage_account_id: string;
  remote_file_id: string;
  name: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  md5_checksum: string | null;
  parent_remote_id: string | null;
  remote_path: string;
  modified_time: string | null;
  is_folder: number;
  is_shortcut: number;
  trashed: number;
  classification: string;
  detected_platform: string | null;
  classification_confidence: number;
  first_seen_at: string;
  last_seen_at: string;
  last_seen_run_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToFile(row: CloudFileRow): CloudFile {
  return {
    id: row.id,
    storageAccountId: row.storage_account_id,
    remoteFileId: row.remote_file_id,
    name: row.name,
    extension: row.extension,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    md5Checksum: row.md5_checksum ?? undefined,
    parentRemoteId: row.parent_remote_id ?? undefined,
    remotePath: row.remote_path,
    modifiedTime: row.modified_time ?? undefined,
    isFolder: Boolean(row.is_folder),
    isShortcut: Boolean(row.is_shortcut),
    trashed: Boolean(row.trashed),
    classification: row.classification as CloudFileClassification,
    detectedPlatform: (row.detected_platform as GamePlatform) ?? undefined,
    classificationConfidence: row.classification_confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSeenRunId: row.last_seen_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class CloudFilesRepository {
  constructor(private db: Database) {}

  public getById(id: string): CloudFile | null {
    const stmt = this.db.prepare('SELECT * FROM cloud_files WHERE id = ?');
    const row = stmt.get(id) as CloudFileRow | undefined;
    return row ? mapRowToFile(row) : null;
  }

  public getByRemoteFileId(storageAccountId: string, remoteFileId: string): CloudFile | null {
    const stmt = this.db.prepare(
      `SELECT * FROM cloud_files
      WHERE storage_account_id = ? AND remote_file_id = ?`
    );
    const row = stmt.get(storageAccountId, remoteFileId) as CloudFileRow | undefined;
    return row ? mapRowToFile(row) : null;
  }

  public getByAccountId(storageAccountId: string): CloudFile[] {
    const stmt = this.db.prepare(
      `SELECT * FROM cloud_files
      WHERE storage_account_id = ? AND trashed = 0
      ORDER BY remote_path ASC`
    );
    const rows = stmt.all(storageAccountId) as CloudFileRow[];
    return rows.map(mapRowToFile);
  }

  public getByParentRemoteId(storageAccountId: string, parentRemoteId: string): CloudFile[] {
    const stmt = this.db.prepare(
      `SELECT * FROM cloud_files
      WHERE storage_account_id = ? AND parent_remote_id = ? AND trashed = 0
      ORDER BY name ASC`
    );
    const rows = stmt.all(storageAccountId, parentRemoteId) as CloudFileRow[];
    return rows.map(mapRowToFile);
  }

  public upsert(file: CloudFile): void {
    const stmt = this.db.prepare(
      `INSERT INTO cloud_files (
        id, storage_account_id, remote_file_id, name, extension, mime_type,
        size_bytes, md5_checksum, parent_remote_id, remote_path, modified_time,
        is_folder, is_shortcut, trashed, classification, detected_platform,
        classification_confidence, first_seen_at, last_seen_at, last_seen_run_id, created_at, updated_at
      ) VALUES (
        @id, @storageAccountId, @remoteFileId, @name, @extension, @mimeType,
        @sizeBytes, @md5Checksum, @parentRemoteId, @remotePath, @modifiedTime,
        @isFolder, @isShortcut, @trashed, @classification, @detectedPlatform,
        @classificationConfidence, @firstSeenAt, @lastSeenAt, @lastSeenRunId, @createdAt, @updatedAt
      )
      ON CONFLICT(storage_account_id, remote_file_id) DO UPDATE SET
        name = excluded.name,
        extension = excluded.extension,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        md5_checksum = excluded.md5_checksum,
        parent_remote_id = excluded.parent_remote_id,
        remote_path = excluded.remote_path,
        modified_time = excluded.modified_time,
        is_folder = excluded.is_folder,
        is_shortcut = excluded.is_shortcut,
        trashed = excluded.trashed,
        classification = excluded.classification,
        detected_platform = excluded.detected_platform,
        classification_confidence = excluded.classification_confidence,
        last_seen_at = excluded.last_seen_at,
        last_seen_run_id = COALESCE(excluded.last_seen_run_id, cloud_files.last_seen_run_id),
        updated_at = excluded.updated_at`
    );

    stmt.run({
      id: file.id,
      storageAccountId: file.storageAccountId,
      remoteFileId: file.remoteFileId,
      name: file.name,
      extension: file.extension,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      md5Checksum: file.md5Checksum ?? null,
      parentRemoteId: file.parentRemoteId ?? null,
      remotePath: file.remotePath,
      modifiedTime: file.modifiedTime ?? null,
      isFolder: file.isFolder ? 1 : 0,
      isShortcut: file.isShortcut ? 1 : 0,
      trashed: file.trashed ? 1 : 0,
      classification: file.classification,
      detectedPlatform: file.detectedPlatform ?? null,
      classificationConfidence: file.classificationConfidence,
      firstSeenAt: file.firstSeenAt,
      lastSeenAt: file.lastSeenAt,
      lastSeenRunId: file.lastSeenRunId ?? null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    });
  }

  public batchUpsert(files: CloudFile[]): void {
    if (files.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT INTO cloud_files (
        id, storage_account_id, remote_file_id, name, extension, mime_type,
        size_bytes, md5_checksum, parent_remote_id, remote_path, modified_time,
        is_folder, is_shortcut, trashed, classification, detected_platform,
        classification_confidence, first_seen_at, last_seen_at, last_seen_run_id, created_at, updated_at
      ) VALUES (
        @id, @storageAccountId, @remoteFileId, @name, @extension, @mimeType,
        @sizeBytes, @md5Checksum, @parentRemoteId, @remotePath, @modifiedTime,
        @isFolder, @isShortcut, @trashed, @classification, @detectedPlatform,
        @classificationConfidence, @firstSeenAt, @lastSeenAt, @lastSeenRunId, @createdAt, @updatedAt
      )
      ON CONFLICT(storage_account_id, remote_file_id) DO UPDATE SET
        name = excluded.name,
        extension = excluded.extension,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        md5_checksum = excluded.md5_checksum,
        parent_remote_id = excluded.parent_remote_id,
        remote_path = excluded.remote_path,
        modified_time = excluded.modified_time,
        is_folder = excluded.is_folder,
        is_shortcut = excluded.is_shortcut,
        trashed = excluded.trashed,
        classification = excluded.classification,
        detected_platform = excluded.detected_platform,
        classification_confidence = excluded.classification_confidence,
        last_seen_at = excluded.last_seen_at,
        last_seen_run_id = COALESCE(excluded.last_seen_run_id, cloud_files.last_seen_run_id),
        updated_at = excluded.updated_at`
    );

    const runBatch = this.db.transaction((items: CloudFile[]) => {
      for (const file of items) {
        stmt.run({
          id: file.id,
          storageAccountId: file.storageAccountId,
          remoteFileId: file.remoteFileId,
          name: file.name,
          extension: file.extension,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          md5Checksum: file.md5Checksum ?? null,
          parentRemoteId: file.parentRemoteId ?? null,
          remotePath: file.remotePath,
          modifiedTime: file.modifiedTime ?? null,
          isFolder: file.isFolder ? 1 : 0,
          isShortcut: file.isShortcut ? 1 : 0,
          trashed: file.trashed ? 1 : 0,
          classification: file.classification,
          detectedPlatform: file.detectedPlatform ?? null,
          classificationConfidence: file.classificationConfidence,
          firstSeenAt: file.firstSeenAt,
          lastSeenAt: file.lastSeenAt,
          lastSeenRunId: file.lastSeenRunId ?? null,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt
        });
      }
    });

    runBatch(files);
  }

  public getFolderByRemoteId(storageAccountId: string, remoteFolderId: string): CloudFile | null {
    const stmt = this.db.prepare(
      `SELECT * FROM cloud_files
      WHERE storage_account_id = ? AND remote_file_id = ? AND is_folder = 1`
    );
    const row = stmt.get(storageAccountId, remoteFolderId) as CloudFileRow | undefined;
    return row ? mapRowToFile(row) : null;
  }

  public updateSubtreePaths(storageAccountId: string, oldFolderPath: string, newFolderPath: string): number {
    const prefix = oldFolderPath.endsWith('/') ? oldFolderPath : `${oldFolderPath}/`;
    const newPrefix = newFolderPath.endsWith('/') ? newFolderPath : `${newFolderPath}/`;
    const prefixLen = prefix.length;

    // Update folder itself first
    const updateSelfStmt = this.db.prepare(
      `UPDATE cloud_files
      SET remote_path = ?, updated_at = ?
      WHERE storage_account_id = ? AND remote_path = ?`
    );
    const now = new Date().toISOString();
    const selfRes = updateSelfStmt.run(newFolderPath, now, storageAccountId, oldFolderPath);

    // Update all descendant files and subfolders
    const updateDescendantsStmt = this.db.prepare(
      `UPDATE cloud_files
      SET remote_path = ? || SUBSTR(remote_path, ?),
          updated_at = ?
      WHERE storage_account_id = ? AND remote_path LIKE ? || '%'`
    );
    const descRes = updateDescendantsStmt.run(newPrefix, prefixLen + 1, now, storageAccountId, prefix);

    return selfRes.changes + descRes.changes;
  }

  public reconcileUnseenFiles(storageAccountId: string, currentRunId: string): string[] {
    const rows = this.db.prepare(
      `SELECT remote_file_id FROM cloud_files
      WHERE storage_account_id = ? 
        AND trashed = 0 
        AND (last_seen_run_id != ? OR last_seen_run_id IS NULL)`
    ).all(storageAccountId, currentRunId) as Array<{ remote_file_id: string }>;

    if (rows.length > 0) {
      const stmt = this.db.prepare(
        `UPDATE cloud_files
        SET trashed = 1, updated_at = ?
        WHERE storage_account_id = ? AND remote_file_id = ?`
      );
      const now = new Date().toISOString();
      const batch = this.db.transaction((items: Array<{ remote_file_id: string }>) => {
        for (const r of items) {
          stmt.run(now, storageAccountId, r.remote_file_id);
        }
      });
      batch(rows);
    }

    return rows.map((r) => r.remote_file_id);
  }

  public updateRemotePath(storageAccountId: string, remoteFileId: string, newPath: string, parentRemoteId?: string): void {
    const stmt = this.db.prepare(
      `UPDATE cloud_files
      SET remote_path = ?, parent_remote_id = COALESCE(?, parent_remote_id), updated_at = ?
      WHERE storage_account_id = ? AND remote_file_id = ?`
    );
    stmt.run(newPath, parentRemoteId ?? null, new Date().toISOString(), storageAccountId, remoteFileId);
  }

  public markTrashed(storageAccountId: string, remoteFileId: string, trashed: boolean): void {
    const stmt = this.db.prepare(
      `UPDATE cloud_files
      SET trashed = ?, updated_at = ?
      WHERE storage_account_id = ? AND remote_file_id = ?`
    );
    stmt.run(trashed ? 1 : 0, new Date().toISOString(), storageAccountId, remoteFileId);
  }

  public countByAccountId(storageAccountId: string): { total: number; folders: number; files: number } {
    const row = this.db.prepare(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END) as folders,
        SUM(CASE WHEN is_folder = 0 THEN 1 ELSE 0 END) as files
      FROM cloud_files
      WHERE storage_account_id = ? AND trashed = 0`
    ).get(storageAccountId) as { total: number; folders: number | null; files: number | null };

    return {
      total: row.total || 0,
      folders: row.folders || 0,
      files: row.files || 0
    };
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cloud_files WHERE id = ?');
    return stmt.run(id).changes > 0;
  }
}
