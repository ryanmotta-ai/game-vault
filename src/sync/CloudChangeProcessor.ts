import crypto from 'node:crypto';
import { RemoteChange } from '../providers/types';
import { StorageProvider } from '../providers/StorageProvider';
import { CloudFilesRepository } from '../database/repositories/cloudFilesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { CatalogIngestionService } from '../catalog/CatalogIngestionService';
import { GameCandidateResolver } from '../catalog/GameCandidateResolver';
import { FileClassifier } from '../catalog/FileClassifier';
import { ExtensionRegistry } from '../catalog/ExtensionRegistry';
import { CloudPathResolver } from './CloudPathResolver';
import { CloudFile } from '../core/types';
import { logger } from '../core/logger';

export interface ChangeProcessingResult {
  filesProcessed: number;
  filesReclassified: number;
  gamesAffected: number;
  durationMs: number;
}

export class CloudChangeProcessor {
  private log = logger.child('CloudChangeProcessor');

  constructor(
    private cloudFilesRepo: CloudFilesRepository,
    private gameFilesRepo: GameFilesRepository,
    private catalogIngestion: CatalogIngestionService,
    private pathResolver: CloudPathResolver
  ) {}

  /**
   * Processes a batch of remote changes from Google Drive Changes API.
   */
  public async processChanges(
    storageAccountId: string,
    provider: StorageProvider,
    changes: RemoteChange[]
  ): Promise<ChangeProcessingResult> {
    const startTime = Date.now();
    let filesProcessed = 0;
    let filesReclassified = 0;
    let gamesAffected = 0;

    for (const change of changes) {
      const isRemoved = change.removed || Boolean(change.file?.trashed);

      if (isRemoved) {
        // 1. Deletion / Trash
        this.cloudFilesRepo.markTrashed(storageAccountId, change.fileId, true);
        const updated = this.gameFilesRepo.updateStatusByRemoteFileId(
          storageAccountId,
          change.fileId,
          'MISSING'
        );
        if (updated) {
          gamesAffected++;
        }
        filesProcessed++;
        continue;
      }

      if (!change.file) {
        filesProcessed++;
        continue;
      }

      const remoteFile = change.file;
      const now = new Date().toISOString();

      if (remoteFile.isFolder) {
        // 2. Folder mutation (add, rename, move)
        const existingFolder = this.cloudFilesRepo.getFolderByRemoteId(storageAccountId, remoteFile.id);
        const { newPath, filesUpdated } = await this.pathResolver.handleFolderRenameOrMove(
          storageAccountId,
          remoteFile.id,
          remoteFile.name,
          remoteFile.parentFolderId,
          provider
        );

        if (filesUpdated > 0) {
          filesReclassified += filesUpdated;
        }

        const folderCloudFile: CloudFile = {
          id: existingFolder?.id || `cf-${crypto.randomUUID()}`,
          storageAccountId,
          remoteFileId: remoteFile.id,
          name: remoteFile.name,
          extension: '',
          mimeType: remoteFile.mimeType,
          sizeBytes: 0,
          parentRemoteId: remoteFile.parentFolderId,
          remotePath: newPath,
          modifiedTime: remoteFile.modifiedTime,
          isFolder: true,
          isShortcut: false,
          trashed: false,
          classification: 'UNKNOWN',
          classificationConfidence: 0,
          firstSeenAt: existingFolder?.firstSeenAt || now,
          lastSeenAt: now,
          createdAt: existingFolder?.createdAt || now,
          updatedAt: now
        };

        this.cloudFilesRepo.upsert(folderCloudFile);
        this.pathResolver.setCachedFolderPath(storageAccountId, remoteFile.id, newPath);
        filesProcessed++;
      } else {
        // 3. Regular File mutation (add, rename, move, restore)
        const filePath = await this.pathResolver.resolveFilePath(storageAccountId, remoteFile, provider);
        const ext = ExtensionRegistry.normalizeExtension(remoteFile.name);
        const classification = FileClassifier.classify({
          name: remoteFile.name,
          extension: ext,
          remotePath: filePath,
          sizeBytes: remoteFile.sizeBytes,
          isFolder: false
        });

        const existingFile = this.cloudFilesRepo.getByRemoteFileId(storageAccountId, remoteFile.id);
        const isNew = !existingFile;

        const cloudFile: CloudFile = {
          id: existingFile?.id || `cf-${crypto.randomUUID()}`,
          storageAccountId,
          remoteFileId: remoteFile.id,
          name: remoteFile.name,
          extension: ext,
          mimeType: remoteFile.mimeType,
          sizeBytes: remoteFile.sizeBytes,
          md5Checksum: remoteFile.md5Checksum,
          parentRemoteId: remoteFile.parentFolderId,
          remotePath: filePath,
          modifiedTime: remoteFile.modifiedTime,
          isFolder: false,
          isShortcut: false,
          trashed: false,
          classification: classification.classification,
          detectedPlatform: classification.detectedPlatform,
          classificationConfidence: classification.confidenceScore,
          firstSeenAt: existingFile?.firstSeenAt || now,
          lastSeenAt: now,
          createdAt: existingFile?.createdAt || now,
          updatedAt: now
        };

        this.cloudFilesRepo.upsert(cloudFile);
        filesProcessed++;

        // Restore in game_files if previously marked missing
        const existingGameFile = this.gameFilesRepo.getByRemoteFileId(storageAccountId, remoteFile.id);
        if (existingGameFile) {
          const pathChanged = existingGameFile.remotePath !== filePath;
          const nameChanged = existingGameFile.filename !== remoteFile.name;
          if (pathChanged || nameChanged) {
            this.gameFilesRepo.updateRemotePath(existingGameFile.id, filePath, remoteFile.name);
            filesReclassified++;
          }
          if (existingGameFile.status === 'MISSING') {
            this.gameFilesRepo.updateStatus(existingGameFile.id, 'REMOTE');
            gamesAffected++;
          }
        }

        // Reconcile into catalog if candidate is HIGH confidence
        if (classification.confidence === 'HIGH') {
          // Resolve candidate for this file (and check for siblings like .bin/.cue in same folder)
          const dirFiles = this.cloudFilesRepo.getByAccountId(storageAccountId).filter((f) => {
            const dir = f.remotePath ? f.remotePath.substring(0, f.remotePath.lastIndexOf('/')) : '/';
            const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
            return dir === fileDir;
          });

          const candidates = GameCandidateResolver.resolveCandidates(
            dirFiles.length > 0 ? dirFiles : [cloudFile]
          );

          if (candidates.length > 0) {
            const ingResult = await this.catalogIngestion.ingestCandidates(candidates, 'HIGH');
            if (ingResult.gamesCreated > 0 || ingResult.gamesUpdated > 0) {
              gamesAffected += ingResult.gamesCreated + ingResult.gamesUpdated;
            }
          }
        } else if (isNew) {
          // New file with lower confidence is saved in cloud_files inventory only
          this.log.debug(`New file '${remoteFile.name}' inventoried with confidence ${classification.confidence}.`);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.log.info(
      `Change processing complete: ${filesProcessed} files processed, ${filesReclassified} reclassified, ${gamesAffected} games affected in ${durationMs}ms.`
    );

    return {
      filesProcessed,
      filesReclassified,
      gamesAffected,
      durationMs
    };
  }
}
