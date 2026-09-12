import crypto from 'node:crypto';
import { StorageProvider } from '../providers/StorageProvider';
import { CloudFilesRepository } from '../database/repositories/cloudFilesRepository';
import { CloudFile } from '../core/types';
import { ExtensionRegistry } from '../catalog/ExtensionRegistry';
import { FileClassifier } from '../catalog/FileClassifier';
import { SyncCancelledError } from '../core/errors/AppError';
import { logger } from '../core/logger';

export class CancellationToken {
  private _isCancelled = false;

  public cancel(): void {
    this._isCancelled = true;
  }

  public get isCancelled(): boolean {
    return this._isCancelled;
  }

  public throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new SyncCancelledError('Sync operation was cancelled by user or system.');
    }
  }
}

export interface ScanProgressReport {
  accountId: string;
  foldersScanned: number;
  filesScanned: number;
  currentPath: string;
}

export class CloudInventoryScanner {
  private log = logger.child('CloudScanner');

  constructor(private cloudFilesRepo: CloudFilesRepository) {}

  /**
   * Scans an entire storage account starting from root folder using iterative BFS traversal.
   * Completely paginates each directory and saves inventory in cloud_files table.
   */
  public async scanAccount(
    provider: StorageProvider,
    cancellationToken?: CancellationToken,
    onProgress?: (report: ScanProgressReport) => void
  ): Promise<{ foldersScanned: number; filesScanned: number }> {
    this.log.info(`Starting cloud inventory scan for account '${provider.name}' (${provider.id})...`);

    let foldersScanned = 0;
    let filesScanned = 0;

    // BFS Queue: { folderId: string (root or subfolder), path: string }
    const queue: Array<{ folderId?: string; currentPath: string }> = [
      { folderId: undefined, currentPath: '' }
    ];

    const visitedFolderIds = new Set<string>();
    const batchBuffer: CloudFile[] = [];
    const BATCH_SIZE = 100;
    let lastProgressReport = Date.now();

    const flushBatch = () => {
      if (batchBuffer.length > 0) {
        this.cloudFilesRepo.batchUpsert(batchBuffer);
        batchBuffer.length = 0;
      }
    };

    while (queue.length > 0) {
      cancellationToken?.throwIfCancelled();

      const current = queue.shift()!;
      const folderKey = current.folderId || 'root';

      if (visitedFolderIds.has(folderKey)) {
        continue;
      }
      visitedFolderIds.add(folderKey);
      foldersScanned++;

      // Throttle progress emissions (at most once every 300ms)
      const nowMs = Date.now();
      if (nowMs - lastProgressReport > 300) {
        onProgress?.({
          accountId: provider.id,
          foldersScanned,
          filesScanned,
          currentPath: current.currentPath || '/'
        });
        lastProgressReport = nowMs;
      }

      // Completely paginate contents of current folder
      let pageToken: string | undefined = undefined;

      do {
        cancellationToken?.throwIfCancelled();

        let paginatedResult;
        if (provider.listPaginatedFiles) {
          paginatedResult = await provider.listPaginatedFiles(current.folderId, {
            pageSize: 1000,
            pageToken
          });
        } else {
          // Fallback if listPaginatedFiles is not implemented
          const files = await provider.listFiles(current.folderId);
          paginatedResult = { files, nextPageToken: undefined };
        }

        const items = paginatedResult.files;
        pageToken = paginatedResult.nextPageToken;

        const now = new Date().toISOString();

        for (const item of items) {
          const itemPath = current.currentPath ? `${current.currentPath}/${item.name}` : `/${item.name}`;

          if (item.isFolder) {
            queue.push({ folderId: item.id, currentPath: itemPath });
          }

          const ext = ExtensionRegistry.normalizeExtension(item.name);
          const classification = FileClassifier.classify({
            name: item.name,
            extension: ext,
            remotePath: itemPath,
            sizeBytes: item.sizeBytes,
            isFolder: item.isFolder
          });

          // Create cloud_file entity
          const cloudFileId = `cf-${crypto.randomUUID()}`;
          const cloudFile: CloudFile = {
            id: cloudFileId,
            storageAccountId: provider.id,
            remoteFileId: item.id,
            name: item.name,
            extension: ext,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
            md5Checksum: item.md5Checksum,
            parentRemoteId: item.parentFolderId,
            remotePath: itemPath,
            modifiedTime: item.modifiedTime,
            isFolder: item.isFolder,
            isShortcut: false,
            trashed: Boolean(item.trashed),
            classification: classification.classification,
            detectedPlatform: classification.detectedPlatform,
            classificationConfidence: classification.confidenceScore,
            firstSeenAt: now,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now
          };

          batchBuffer.push(cloudFile);
          if (!item.isFolder) {
            filesScanned++;
          }

          if (batchBuffer.length >= BATCH_SIZE) {
            flushBatch();
          }
        }
      } while (pageToken);
    }

    // Flush any remaining items in buffer
    flushBatch();

    onProgress?.({
      accountId: provider.id,
      foldersScanned,
      filesScanned,
      currentPath: '/'
    });

    this.log.info(
      `Scan completed for '${provider.name}': ${foldersScanned} folders visited, ${filesScanned} items indexed.`
    );
    return { foldersScanned, filesScanned };
  }
}
