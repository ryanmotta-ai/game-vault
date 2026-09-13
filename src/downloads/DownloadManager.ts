import fs from 'node:fs';
import { DownloadItem, DownloadProgressEvent, DownloadStateChangedEvent, GameState } from '../core/types';
import { DownloadTaskRequest } from './types';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { StorageManager } from '../storage/StorageManager';
import { CacheManager } from '../storage/CacheManager';
import { DownloadScheduler } from './DownloadScheduler';
import { GameAvailabilityService } from '../catalog/GameAvailabilityService';
import { GamePreparationService } from '../preparation/GamePreparationService';
import { logger } from '../core/logger';
import {
  NotFoundError,
  InsufficientDiskSpaceError
} from '../core/errors/AppError';
import { sanitizeFilename } from '../core/utils/pathSafety';

// Pre-flight disk space safety margin: 512 MB
const DISK_SAFETY_MARGIN_BYTES = 512 * 1024 * 1024;

export class DownloadManager {
  private log = logger.child('DownloadManager');
  private progressListeners = new Set<(event: DownloadProgressEvent) => void>();
  private stateListeners = new Set<(event: DownloadStateChangedEvent) => void>();

  private scheduler: DownloadScheduler;
  private availabilityService: GameAvailabilityService;
  private preparationService?: GamePreparationService;

  constructor(
    private downloadsRepo: DownloadsRepository,
    private gamesRepo: GamesRepository,
    private gameFilesRepo?: GameFilesRepository,
    private storageManager?: StorageManager,
    private cacheManager?: CacheManager,
    preparationService?: GamePreparationService
  ) {
    this.preparationService = preparationService;
    this.availabilityService = new GameAvailabilityService(
      this.gamesRepo,
      this.gameFilesRepo || ({} as GameFilesRepository),
      this.downloadsRepo,
      this.cacheManager
    );

    this.scheduler = new DownloadScheduler(
      this.downloadsRepo,
      this.gameFilesRepo || ({} as GameFilesRepository),
      this.storageManager || ({} as StorageManager),
      this.cacheManager || ({} as CacheManager)
    );

    this.wireScheduler();
  }

  public setPreparationService(service: GamePreparationService): void {
    this.preparationService = service;
  }

  public getPreparationService(): GamePreparationService | undefined {
    return this.preparationService;
  }

  public setGameFilesRepository(repo: GameFilesRepository): void {
    this.gameFilesRepo = repo;
    this.reinitSubservices();
  }

  public setStorageManager(manager: StorageManager): void {
    this.storageManager = manager;
    this.reinitSubservices();
  }

  public setCacheManager(cache: CacheManager): void {
    this.cacheManager = cache;
    this.reinitSubservices();
  }

  private reinitSubservices(): void {
    if (this.gameFilesRepo) {
      this.availabilityService = new GameAvailabilityService(
        this.gamesRepo,
        this.gameFilesRepo,
        this.downloadsRepo,
        this.cacheManager
      );
    }
    if (this.gameFilesRepo && this.storageManager && this.cacheManager) {
      this.scheduler = new DownloadScheduler(
        this.downloadsRepo,
        this.gameFilesRepo,
        this.storageManager,
        this.cacheManager
      );
      this.wireScheduler();
    }
  }

  private wireScheduler(): void {
    this.scheduler.setCallbacks(
      (progress) => this.notifyProgress(progress),
      (stateEvent) => {
        this.recalculateGameState(stateEvent.gameId);
        this.notifyStateChanged(stateEvent);

        // Download -> Preparation handoff:
        // When a download completes, check if all files for this game are cached locally
        if (stateEvent.status === 'COMPLETED' && this.preparationService && this.gameFilesRepo) {
          const files = this.gameFilesRepo.getByGameId(stateEvent.gameId);
          const allCompleted =
            files.length > 0 &&
            files.every((f) => f.status === 'CACHED_LOCAL' && f.localPath && fs.existsSync(f.localPath));
          if (allCompleted) {
            this.log.info(`All files downloaded for game ${stateEvent.gameId}. Automatically initiating preparation...`);
            this.preparationService.prepare(stateEvent.gameId).catch((err) => {
              this.log.error(`Auto-preparation error for game ${stateEvent.gameId}:`, err);
            });
          }
        }
      }
    );
  }

  public onProgress(listener: (event: DownloadProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  public onStateChanged(listener: (event: DownloadStateChangedEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  protected notifyProgress(event: DownloadProgressEvent): void {
    for (const listener of this.progressListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('Error in download progress listener:', err);
      }
    }
  }

  protected notifyStateChanged(event: DownloadStateChangedEvent): void {
    for (const listener of this.stateListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('Error in download state changed listener:', err);
      }
    }
  }

  /**
   * Recovers any download left in 'DOWNLOADING' status when app exited or crashed.
   * In Phase 3B, preserves valid partial files and sets status to PAUSED (INTERRUPTED_BY_APP_EXIT).
   */
  public recoverStaleDownloads(): number {
    const staleItems = this.downloadsRepo.getStaleDownloading();
    if (staleItems.length === 0) return 0;

    this.log.warn(`Found ${staleItems.length} stale download(s) from previous session. Recovering as PAUSED...`);
    for (const item of staleItems) {
      const partialPath =
        item.partialPath || (this.cacheManager ? this.cacheManager.getPartialFilePath(item.id) : null);

      if (partialPath && fs.existsSync(partialPath)) {
        const stat = fs.statSync(partialPath);
        if (item.totalBytes > 0 && stat.size > item.totalBytes) {
          this.log.warn(
            `Stale partial ${partialPath} was oversized (${stat.size} > ${item.totalBytes}). Removing.`
          );
          try {
            fs.unlinkSync(partialPath);
          } catch {
            // Ignore
          }
          this.downloadsRepo.updateProgress(item.id, 0, 0);
          this.downloadsRepo.updateStatus(item.id, 'PAUSED', 'INVALID_PARTIAL');
        } else {
          this.log.info(`Stale partial ${partialPath} has ${stat.size} bytes. Preserving for resume.`);
          this.downloadsRepo.updateProgress(item.id, stat.size, 0);
          this.downloadsRepo.updateStatus(item.id, 'PAUSED', 'INTERRUPTED_BY_APP_EXIT');
        }
      } else {
        this.downloadsRepo.updateProgress(item.id, 0, 0);
        this.downloadsRepo.updateStatus(item.id, 'PAUSED', 'INTERRUPTED_BY_APP_EXIT');
      }

      this.recalculateGameState(item.gameId);
    }
    return staleItems.length;
  }

  /**
   * Queues downloads for ALL required files of a game (multi-file games, bin/cue, multi-disc).
   * Returns the primary file's download item.
   */
  public async queueGame(gameId: string): Promise<DownloadItem> {
    if (!gameId || typeof gameId !== 'string') {
      throw new NotFoundError('Valid game ID is required.');
    }

    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found with ID: ${gameId}`);
    }

    if (!this.gameFilesRepo) {
      throw new Error('GameFilesRepository is not configured in DownloadManager.');
    }

    const files = this.gameFilesRepo.getByGameId(gameId);
    if (files.length === 0) {
      throw new NotFoundError(`No game files found for game "${game.title}" (${gameId}).`);
    }

    // Identify files not yet cached locally
    const missingFiles = files.filter(
      (f) =>
        f.status !== 'CACHED_LOCAL' ||
        !f.localPath ||
        !(this.cacheManager && this.cacheManager.verifyLocalFile(f.localPath, f.sizeBytes))
    );

    if (missingFiles.length === 0) {
      // All files cached
      this.recalculateGameState(gameId);
      const firstExisting = this.downloadsRepo.getAll().find((d) => d.gameId === gameId && d.status === 'COMPLETED');
      if (firstExisting) return firstExisting;

      return {
        id: `dl-cached-${files[0].id}`,
        gameId,
        gameFileId: files[0].id,
        storageAccountId: files[0].storageAccountId,
        status: 'COMPLETED',
        totalBytes: files[0].sizeBytes,
        downloadedBytes: files[0].sizeBytes,
        downloadSpeedBps: 0,
        destinationPath: files[0].localPath,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    }

    // In BIN/CUE sets or multi-file games, queue all missing files
    const queuedItems = await this.queueGameFiles(gameId);

    // Determine primary item to return (e.g. cue file or first file)
    const cueItem = queuedItems.find((item) => {
      const gf = files.find((f) => f.id === item.gameFileId);
      return gf?.filename.toLowerCase().endsWith('.cue');
    });

    return cueItem || queuedItems[0];
  }

  /**
   * Queues downloads for ALL missing files of a game and returns the array of DownloadItems.
   */
  public async queueGameFiles(gameId: string): Promise<DownloadItem[]> {
    if (!gameId || typeof gameId !== 'string') {
      throw new NotFoundError('Valid game ID is required.');
    }

    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found with ID: ${gameId}`);
    }

    if (!this.gameFilesRepo) {
      throw new Error('GameFilesRepository is not configured in DownloadManager.');
    }

    const files = this.gameFilesRepo.getByGameId(gameId);
    if (files.length === 0) {
      throw new NotFoundError(`No game files found for game "${game.title}" (${gameId}).`);
    }

    const missingFiles = files.filter(
      (f) =>
        f.status !== 'CACHED_LOCAL' ||
        !f.localPath ||
        !(this.cacheManager && this.cacheManager.verifyLocalFile(f.localPath, f.sizeBytes))
    );

    const queuedItems: DownloadItem[] = [];
    for (const file of missingFiles) {
      const item = await this.queueGameFile(file.id);
      queuedItems.push(item);
    }
    return queuedItems;
  }

  /**
   * Queues download for a specific game file ID.
   */
  public async queueGameFile(gameFileId: string): Promise<DownloadItem> {
    if (!gameFileId || typeof gameFileId !== 'string') {
      throw new NotFoundError('Valid game file ID is required.');
    }

    if (!this.gameFilesRepo || !this.cacheManager) {
      throw new Error('Required repositories/managers are not configured in DownloadManager.');
    }

    const file = this.gameFilesRepo.getById(gameFileId);
    if (!file) {
      throw new NotFoundError(`Game file not found with ID: ${gameFileId}`);
    }

    const game = this.gamesRepo.getById(file.gameId);
    if (!game) {
      throw new NotFoundError(`Parent game not found for file ID: ${gameFileId}`);
    }

    // 1. Prevent duplicate active, queued, or paused downloads
    const existingActive = this.downloadsRepo.getActiveByGameFileId(gameFileId);
    if (existingActive) {
      this.log.info(
        `Download already active/queued/paused for game file ${gameFileId} (Download: ${existingActive.id}, Status: ${existingActive.status}). Returning existing.`
      );
      if (existingActive.status === 'PAUSED') {
        // If paused, user clicking queue should resume it
        await this.resumeDownload(existingActive.id);
      }
      return existingActive;
    }

    // 2. Check if file is already valid on disk
    if (file.status === 'CACHED_LOCAL' && file.localPath) {
      if (this.cacheManager.verifyLocalFile(file.localPath, file.sizeBytes)) {
        this.log.info(`File ${file.filename} is already cached and verified on disk. Skipping download.`);
        this.recalculateGameState(game.id);
        const existingDownload = this.downloadsRepo
          .getAll()
          .find((d) => d.gameFileId === gameFileId && d.status === 'COMPLETED');
        if (existingDownload) return existingDownload;

        return {
          id: `dl-cached-${file.id}`,
          gameId: file.gameId,
          gameFileId: file.id,
          storageAccountId: file.storageAccountId,
          status: 'COMPLETED',
          totalBytes: file.sizeBytes,
          downloadedBytes: file.sizeBytes,
          downloadSpeedBps: 0,
          destinationPath: file.localPath,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        };
      } else {
        // Self-heal: DB says cached but file is missing on disk
        this.log.warn(`File ${file.filename} was marked CACHED_LOCAL but missing from disk. Re-queueing download.`);
        this.gameFilesRepo.updateStatus(file.id, 'REMOTE');
      }
    }

    // 3. Pre-flight Disk Space Verification (Download + Estimated Extraction + 512 MB safety margin)
    const availableDiskBytes = this.cacheManager.getAvailableDiskSpace();
    const isArchive = ['.zip', '.7z', '.rar'].some((ext) => file.filename.toLowerCase().endsWith(ext));
    const estimatedExtractionBytes = isArchive ? Math.round(file.sizeBytes * 2.5) : 0;
    const requiredBytes = file.sizeBytes + estimatedExtractionBytes + DISK_SAFETY_MARGIN_BYTES;
    if (availableDiskBytes < requiredBytes) {
      this.log.error(
        `Insufficient disk space to download ${file.filename}: required ${requiredBytes} bytes (${(requiredBytes / 1024 / 1024).toFixed(1)} MB, including ${isArchive ? 'estimated extraction + ' : ''}512 MB buffer), available ${availableDiskBytes} bytes (${(availableDiskBytes / 1024 / 1024).toFixed(1)} MB)`
      );

      const failedItem: DownloadItem = {
        id: `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        gameId: file.gameId,
        gameFileId: file.id,
        storageAccountId: file.storageAccountId,
        status: 'FAILED',
        totalBytes: file.sizeBytes,
        downloadedBytes: 0,
        downloadSpeedBps: 0,
        errorMessage: 'INSUFFICIENT_DISK_SPACE',
        lastErrorCode: 'INSUFFICIENT_DISK_SPACE',
        createdAt: new Date().toISOString()
      };
      this.downloadsRepo.upsert(failedItem);
      this.recalculateGameState(game.id);
      this.notifyStateChanged({
        downloadId: failedItem.id,
        gameId: file.gameId,
        gameFileId: file.id,
        status: 'FAILED',
        error: 'INSUFFICIENT_DISK_SPACE',
        errorReason: 'INSUFFICIENT_DISK_SPACE'
      });
      throw new InsufficientDiskSpaceError(
        `Insufficient disk space to download ${file.filename}. Required: ${(requiredBytes / 1024 / 1024).toFixed(1)} MB (including 512 MB buffer), Available: ${(availableDiskBytes / 1024 / 1024).toFixed(1)} MB.`
      );
    }

    // 4. Construct sanitized paths
    const downloadId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const safeFilename = sanitizeFilename(file.filename);
    const finalDestinationPath = this.cacheManager.getFinalGameFilePath(file.gameId, safeFilename);
    const partialPath = this.cacheManager.getPartialFilePath(downloadId);

    const item: DownloadItem = {
      id: downloadId,
      gameId: file.gameId,
      gameFileId: file.id,
      storageAccountId: file.storageAccountId,
      status: 'QUEUED',
      totalBytes: file.sizeBytes,
      downloadedBytes: 0,
      downloadSpeedBps: 0,
      destinationPath: finalDestinationPath,
      partialPath: partialPath,
      priority: 0,
      retryCount: 0,
      resumeSupported: true,
      remoteMd5: file.md5Checksum,
      createdAt: new Date().toISOString()
    };

    this.downloadsRepo.upsert(item);
    this.recalculateGameState(file.gameId);

    this.notifyStateChanged({
      downloadId: item.id,
      gameId: file.gameId,
      gameFileId: file.id,
      status: 'QUEUED'
    });

    this.log.info(`Queued download ${downloadId} for file "${file.filename}" (Game: "${game.title}").`);

    // Dispatch scheduler
    setImmediate(() => {
      this.scheduler.dispatchNext().catch((err) => {
        this.log.error('Error dispatching scheduler on queueGameFile:', err);
      });
    });

    return item;
  }

  public async queueDownload(request: DownloadTaskRequest): Promise<DownloadItem> {
    if (request.gameFileId) {
      return await this.queueGameFile(request.gameFileId);
    }
    return await this.queueGame(request.gameId);
  }

  public async pauseDownload(downloadId: string): Promise<void> {
    await this.scheduler.pause(downloadId);
    const item = this.downloadsRepo.getById(downloadId);
    if (item) this.recalculateGameState(item.gameId);
  }

  public async resumeDownload(downloadId: string): Promise<void> {
    await this.scheduler.resume(downloadId);
    const item = this.downloadsRepo.getById(downloadId);
    if (item) this.recalculateGameState(item.gameId);
  }

  public async cancelDownload(downloadId: string): Promise<void> {
    await this.scheduler.cancel(downloadId);
    const item = this.downloadsRepo.getById(downloadId);
    if (item) this.recalculateGameState(item.gameId);
  }

  public async initialize(): Promise<void> {
    this.recoverStaleDownloads();
  }

  public async pause(downloadId: string): Promise<void> {
    return this.pauseDownload(downloadId);
  }

  public async resume(downloadId: string): Promise<void> {
    return this.resumeDownload(downloadId);
  }

  public async cancel(downloadId: string): Promise<void> {
    return this.cancelDownload(downloadId);
  }

  public prioritizeDownload(downloadId: string): void {
    this.scheduler.prioritize(downloadId);
  }

  public prioritize(downloadId: string): void {
    this.prioritizeDownload(downloadId);
  }

  public setMaxConcurrent(slots: number): void {
    this.scheduler.setMaxConcurrent(slots);
  }

  public getMaxConcurrent(): number {
    return this.scheduler.getMaxConcurrent();
  }

  public clearCompleted(): number {
    return this.downloadsRepo.clearCompleted();
  }

  public recalculateGameState(gameId: string): GameState {
    return this.availabilityService.recalculate(gameId);
  }

  public getActiveDownloads(): DownloadItem[] {
    return this.downloadsRepo.getActive();
  }

  public getActiveDownload(): DownloadItem | null {
    const activeList = this.downloadsRepo.getActive();
    return activeList.find((d) => d.status === 'DOWNLOADING') || null;
  }

  public getAllDownloads(): DownloadItem[] {
    return this.downloadsRepo.getAll();
  }

  public async shutdown(): Promise<void> {
    await this.scheduler.shutdown();
  }
}
