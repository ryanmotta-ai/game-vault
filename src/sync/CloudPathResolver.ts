import { RemoteFile } from '../providers/types';
import { StorageProvider } from '../providers/StorageProvider';
import { CloudFilesRepository } from '../database/repositories/cloudFilesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { logger } from '../core/logger';

export class CloudPathResolver {
  private log = logger.child('CloudPathResolver');
  private folderPathCache = new Map<string, string>(); // `${accountId}:${folderId}` -> remotePath

  constructor(
    private cloudFilesRepo: CloudFilesRepository,
    private gameFilesRepo?: GameFilesRepository
  ) {}

  public clearCache(accountId?: string): void {
    if (accountId) {
      for (const key of this.folderPathCache.keys()) {
        if (key.startsWith(`${accountId}:`)) {
          this.folderPathCache.delete(key);
        }
      }
    } else {
      this.folderPathCache.clear;
    }
  }

  public setCachedFolderPath(storageAccountId: string, folderId: string, folderPath: string): void {
    this.folderPathCache.set(`${storageAccountId}:${folderId}`, folderPath);
  }

  /**
   * Resolves full virtual path for a remote folder ID using cache, SQLite, or provider API.
   */
  public async resolveFolderPath(
    storageAccountId: string,
    folderId?: string,
    provider?: StorageProvider
  ): Promise<string> {
    if (!folderId || folderId === 'root') {
      return '';
    }

    const cacheKey = `${storageAccountId}:${folderId}`;
    if (this.folderPathCache.has(cacheKey)) {
      return this.folderPathCache.get(cacheKey)!;
    }

    // 1. Check local inventory in SQLite
    const folderRecord = this.cloudFilesRepo.getFolderByRemoteId(storageAccountId, folderId);
    if (folderRecord && folderRecord.remotePath) {
      this.folderPathCache.set(cacheKey, folderRecord.remotePath);
      return folderRecord.remotePath;
    }

    // 2. Fetch via provider getFile() if available
    if (provider && provider.getFile) {
      try {
        const remoteFolder = await provider.getFile(folderId);
        if (remoteFolder && remoteFolder.name) {
          const parentPath = await this.resolveFolderPath(
            storageAccountId,
            remoteFolder.parentFolderId,
            provider
          );
          const folderPath = parentPath ? `${parentPath}/${remoteFolder.name}` : `/${remoteFolder.name}`;
          this.folderPathCache.set(cacheKey, folderPath);
          return folderPath;
        }
      } catch (err) {
        this.log.warn(`Failed to resolve parent folder ${folderId} via provider API:`, err);
      }
    }

    // Fallback if parent cannot be resolved
    return '';
  }

  /**
   * Resolves the full virtual path for a remote file (e.g. /ROMs/PS2/Game.iso).
   */
  public async resolveFilePath(
    storageAccountId: string,
    remoteFile: RemoteFile,
    provider?: StorageProvider
  ): Promise<string> {
    if (remoteFile.path) {
      return remoteFile.path;
    }

    const parentPath = await this.resolveFolderPath(
      storageAccountId,
      remoteFile.parentFolderId,
      provider
    );

    return parentPath ? `${parentPath}/${remoteFile.name}` : `/${remoteFile.name}`;
  }

  /**
   * Updates subtree paths in both cloud_files and game_files when a folder is renamed or moved.
   */
  public async handleFolderRenameOrMove(
    storageAccountId: string,
    folderRemoteId: string,
    newName: string,
    newParentRemoteId?: string,
    provider?: StorageProvider
  ): Promise<{ oldPath: string; newPath: string; filesUpdated: number }> {
    const existingFolder = this.cloudFilesRepo.getFolderByRemoteId(storageAccountId, folderRemoteId);
    const oldPath = existingFolder?.remotePath;

    const newParentPath = await this.resolveFolderPath(storageAccountId, newParentRemoteId, provider);
    const newPath = newParentPath ? `${newParentPath}/${newName}` : `/${newName}`;

    let filesUpdated = 0;
    if (oldPath && oldPath !== newPath) {
      this.log.info(`Folder renamed/moved from '${oldPath}' to '${newPath}'. Updating subtree paths...`);
      const cfUpdated = this.cloudFilesRepo.updateSubtreePaths(storageAccountId, oldPath, newPath);
      const gfUpdated = this.gameFilesRepo
        ? this.gameFilesRepo.updateSubtreePaths(storageAccountId, oldPath, newPath)
        : 0;

      filesUpdated = cfUpdated + gfUpdated;
      this.folderPathCache.set(`${storageAccountId}:${folderRemoteId}`, newPath);
    }

    return {
      oldPath: oldPath || newPath,
      newPath,
      filesUpdated
    };
  }
}
