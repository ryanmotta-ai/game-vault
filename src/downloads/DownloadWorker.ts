import fs from 'node:fs';
import path from 'node:path';
import { DownloadItem, DownloadProgressEvent, DownloadStateChangedEvent } from '../core/types';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { StorageManager } from '../storage/StorageManager';
import { CacheManager } from '../storage/CacheManager';
import { logger } from '../core/logger';
import {
  ChecksumMismatchError,
  DownloadCancelledError,
  InvalidPartialFileError,
  InvalidRangeResponseError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  RemoteFileChangedError,
  RemoteFileUnavailableError,
  RemoteNotFoundError
} from '../core/errors/AppError';
import { sanitizeFilename } from '../core/utils/pathSafety';
import { calculateFileMd5 } from '../core/utils/checksum';

export interface DownloadWorkerOptions {
  item: DownloadItem;
  downloadsRepo: DownloadsRepository;
  gameFilesRepo: GameFilesRepository;
  storageManager: StorageManager;
  cacheManager: CacheManager;
  maxRetries?: number;
  onProgress?: (event: DownloadProgressEvent) => void;
  onStateChanged?: (event: DownloadStateChangedEvent) => void;
}

export class DownloadWorker {
  private log = logger.child('DownloadWorker');
  private item: DownloadItem;
  private downloadsRepo: DownloadsRepository;
  private gameFilesRepo: GameFilesRepository;
  private storageManager: StorageManager;
  private cacheManager: CacheManager;
  private maxRetries: number;

  private onProgressCb?: (event: DownloadProgressEvent) => void;
  private onStateChangedCb?: (event: DownloadStateChangedEvent) => void;

  private abortController: AbortController | null = null;
  private isPaused = false;
  private isCancelled = false;
  private isRunning = false;

  constructor(options: DownloadWorkerOptions) {
    this.item = { ...options.item };
    this.downloadsRepo = options.downloadsRepo;
    this.gameFilesRepo = options.gameFilesRepo;
    this.storageManager = options.storageManager;
    this.cacheManager = options.cacheManager;
    this.maxRetries = options.maxRetries ?? 5;
    this.onProgressCb = options.onProgress;
    this.onStateChangedCb = options.onStateChanged;
  }

  public get downloadId(): string {
    return this.item.id;
  }

  public get isWorking(): boolean {
    return this.isRunning;
  }

  /**
   * Executes the download with resume, remote mutation validation, and retry with backoff.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.abortController = new AbortController();

    const provider = this.storageManager.getProvider(this.item.storageAccountId);
    const gameFile = this.item.gameFileId ? this.gameFilesRepo.getById(this.item.gameFileId) : null;
    if (!gameFile) {
      this.isRunning = false;
      throw new NotFoundError(`Game file not found for download ${this.item.id}`);
    }

    const partialPath = this.item.partialPath || this.cacheManager.getPartialFilePath(this.item.id);
    const destinationPath =
      this.item.destinationPath ||
      this.cacheManager.getFinalGameFilePath(this.item.gameId, sanitizeFilename(gameFile.filename));

    this.item.partialPath = partialPath;
    this.item.destinationPath = destinationPath;

    // Transition to DOWNLOADING in database and notify
    this.item.status = 'DOWNLOADING';
    this.item.startedAt = this.item.startedAt || new Date().toISOString();
    this.downloadsRepo.upsert(this.item);

    this.notifyStateChanged({
      downloadId: this.item.id,
      gameId: this.item.gameId,
      gameFileId: this.item.gameFileId,
      status: 'DOWNLOADING'
    });

    let retryCount = this.item.retryCount || 0;

    try {
      // 1. Remote Mutation Check
      try {
        const meta = await provider.getMetadata(gameFile.remoteFileId);
        if (meta) {
          if (
            (this.item.remoteMd5 && meta.md5Checksum && this.item.remoteMd5 !== meta.md5Checksum) ||
            (this.item.remoteModifiedTime && meta.modifiedTime && this.item.remoteModifiedTime !== meta.modifiedTime) ||
            (this.item.totalBytes > 0 && meta.sizeBytes > 0 && this.item.totalBytes !== meta.sizeBytes)
          ) {
            this.log.error(
              `Remote file ${gameFile.remoteFileId} mutated since download started. Invalidating partial.`
            );
            if (fs.existsSync(partialPath)) {
              try {
                fs.unlinkSync(partialPath);
              } catch {
                // Ignore cleanup error
              }
            }
            throw new RemoteFileChangedError(
              `Remote file "${gameFile.filename}" changed on storage provider.`
            );
          }

          // Persist metadata
          this.item.remoteMd5 = meta.md5Checksum || this.item.remoteMd5;
          this.item.remoteModifiedTime = meta.modifiedTime || this.item.remoteModifiedTime;
          if (meta.sizeBytes > 0) {
            this.item.totalBytes = meta.sizeBytes;
          }
          this.downloadsRepo.upsert(this.item);
        }
      } catch (metaErr) {
        if (metaErr instanceof RemoteFileChangedError) throw metaErr;
        this.log.warn(`Could not refresh remote metadata for ${gameFile.remoteFileId}:`, metaErr);
      }

      // Retry Loop
      while (this.isRunning && !this.isPaused && !this.isCancelled) {
        // Check partial file on disk
        let currentOffset = 0;
        if (fs.existsSync(partialPath)) {
          const stat = fs.statSync(partialPath);
          currentOffset = stat.size;

          // Check for oversized partial: quarantine/remove and self-heal from 0
          if (this.item.totalBytes > 0 && currentOffset > this.item.totalBytes) {
            this.log.warn(
              `Partial file ${partialPath} size (${currentOffset}) exceeds expected size (${this.item.totalBytes}). Removing corrupt partial and resetting to byte 0.`
            );
            try {
              fs.unlinkSync(partialPath);
            } catch {
              // Ignore
            }
            currentOffset = 0;
          }

          // If partial file is already complete size, validate and finalize immediately
          if (this.item.totalBytes > 0 && currentOffset === this.item.totalBytes) {
            this.log.info(
              `Partial file ${partialPath} already has complete size (${currentOffset}). Finalizing directly.`
            );
            await this.finalizeFile(partialPath, destinationPath, gameFile.md5Checksum);
            return;
          }
        } else {
          // If partial does not exist, offset must be 0
          currentOffset = 0;
        }

        this.item.downloadedBytes = currentOffset;
        this.downloadsRepo.updateProgress(this.item.id, currentOffset, 0);

        let lastDbPersist = Date.now();

        try {
          // Execute download stream
          await provider.download(
            {
              fileId: gameFile.remoteFileId,
              destinationPath: partialPath,
              startByte: currentOffset,
              expectedSize: this.item.totalBytes,
              signal: this.abortController?.signal
            },
            (progress) => {
              const now = Date.now();
              if (now - lastDbPersist >= 1000) {
                this.downloadsRepo.updateProgress(this.item.id, progress.bytesTransferred, progress.speedBps);
                lastDbPersist = now;
              }

              this.notifyProgress({
                downloadId: this.item.id,
                gameId: this.item.gameId,
                gameFileId: this.item.gameFileId,
                bytesTransferred: progress.bytesTransferred,
                totalBytes: progress.totalBytes,
                speedBps: progress.speedBps,
                percentage: progress.percentage,
                status: 'DOWNLOADING',
                etaSeconds: progress.etaSeconds,
                retryCount
              });
            }
          );

          // If reached here without throwing, stream completed!
          await this.finalizeFile(partialPath, destinationPath, gameFile.md5Checksum);
          return;
        } catch (err: unknown) {
          const isAbort =
            this.isPaused ||
            this.isCancelled ||
            err instanceof DownloadCancelledError ||
            (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') ||
            Boolean(this.abortController?.signal.aborted);

          if (isAbort) {
            if (this.isPaused) {
              const realBytes = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : currentOffset;
              this.item.status = 'PAUSED';
              this.item.downloadedBytes = realBytes;
              this.item.downloadSpeedBps = 0;
              this.downloadsRepo.updateProgress(this.item.id, realBytes, 0);
              this.downloadsRepo.updateStatus(this.item.id, 'PAUSED', 'Paused by user');

              this.notifyStateChanged({
                downloadId: this.item.id,
                gameId: this.item.gameId,
                gameFileId: this.item.gameFileId,
                status: 'PAUSED'
              });
              return;
            }

            if (this.isCancelled) {
              if (fs.existsSync(partialPath)) {
                try {
                  fs.unlinkSync(partialPath);
                } catch {
                  // Ignore
                }
              }
              this.item.status = 'CANCELLED';
              this.downloadsRepo.updateStatus(this.item.id, 'CANCELLED', 'Cancelled by user', new Date().toISOString());

              this.notifyStateChanged({
                downloadId: this.item.id,
                gameId: this.item.gameId,
                gameFileId: this.item.gameFileId,
                status: 'CANCELLED'
              });
              return;
            }
          }

          // Handle non-retryable errors
          if (
            err instanceof RemoteFileChangedError ||
            err instanceof RemoteNotFoundError ||
            err instanceof RemoteFileUnavailableError ||
            err instanceof PermissionDeniedError ||
            err instanceof InvalidPartialFileError ||
            err instanceof ChecksumMismatchError
          ) {
            throw err;
          }

          // Handle 416 Range Not Satisfiable:
          // Check if partial already matches total expected size
          if (err instanceof InvalidRangeResponseError && String(err.message).includes('416')) {
            if (fs.existsSync(partialPath)) {
              const st = fs.statSync(partialPath);
              if (this.item.totalBytes > 0 && st.size === this.item.totalBytes) {
                this.log.info('416 received but partial file matches total bytes. Attempting finalization.');
                await this.finalizeFile(partialPath, destinationPath, gameFile.md5Checksum);
                return;
              }
            }
          }

          // If server returned 200 OK instead of 206 for range request, restart from 0
          if (err instanceof InvalidRangeResponseError && String(err.message).includes('200 OK')) {
            this.log.warn('Server responded 200 OK for Range request. Restarting partial file from byte 0.');
            if (fs.existsSync(partialPath)) {
              try {
                fs.unlinkSync(partialPath);
              } catch {
                // Ignore
              }
            }
          }

          // Handle transient retryable errors
          retryCount++;
          const errCode = (err && typeof err === 'object' && 'code' in err) ? String((err as { code: unknown }).code) : 'NETWORK_ERROR';
          const errMsg = err instanceof Error ? err.message : String(err);

          if (retryCount > this.maxRetries) {
            this.log.error(`Download ${this.item.id} exhausted maximum retries (${this.maxRetries}). Error: ${errMsg}`);
            this.item.status = 'PAUSED';
            this.item.lastErrorCode = errCode;
            this.item.errorReason = errMsg;
            this.downloadsRepo.updateRetry(this.item.id, retryCount, errCode);
            this.downloadsRepo.updateStatus(this.item.id, 'PAUSED', errMsg, undefined, errCode);

            this.notifyStateChanged({
              downloadId: this.item.id,
              gameId: this.item.gameId,
              gameFileId: this.item.gameFileId,
              status: 'PAUSED',
              error: errMsg,
              errorReason: errCode,
              retryCount
            });
            return;
          }

          // Calculate exponential backoff delay with jitter
          let delayMs = 1000 * Math.pow(2, retryCount - 1);
          if (err instanceof RateLimitedError && err.retryAfterSeconds) {
            delayMs = err.retryAfterSeconds * 1000;
          } else {
            delayMs = Math.min(delayMs, 16000) + Math.floor(Math.random() * 500);
          }

          const retrySec = Math.ceil(delayMs / 1000);
          this.log.warn(
            `Download ${this.item.id} encountered transient error (${errMsg}). Retrying in ${retrySec}s (Attempt ${retryCount}/${this.maxRetries})...`
          );

          this.downloadsRepo.updateRetry(this.item.id, retryCount, errCode);
          this.notifyStateChanged({
            downloadId: this.item.id,
            gameId: this.item.gameId,
            gameFileId: this.item.gameFileId,
            status: 'DOWNLOADING',
            error: errMsg,
            errorReason: errCode,
            retryCount,
            nextRetryInSeconds: retrySec
          });

          // Wait backoff duration
          this.abortController = new AbortController();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delayMs);
            this.abortController?.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      }
    } catch (fatalErr: unknown) {
      const isCancelled = this.isCancelled || fatalErr instanceof DownloadCancelledError;
      if (isCancelled) {
        if (fs.existsSync(partialPath)) {
          try {
            fs.unlinkSync(partialPath);
          } catch {
            // Ignore
          }
        }
        this.item.status = 'CANCELLED';
        this.downloadsRepo.updateStatus(this.item.id, 'CANCELLED', 'Cancelled by user', new Date().toISOString());
        this.notifyStateChanged({
          downloadId: this.item.id,
          gameId: this.item.gameId,
          gameFileId: this.item.gameFileId,
          status: 'CANCELLED'
        });
        return;
      }

      const errCode =
        (fatalErr && typeof fatalErr === 'object' && 'code' in fatalErr)
          ? String((fatalErr as { code: unknown }).code)
          : 'DOWNLOAD_FAILED';
      const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);

      this.log.error(`Download ${this.item.id} failed permanently: ${errMsg}`);
      if (
        (fatalErr instanceof ChecksumMismatchError ||
          fatalErr instanceof RemoteNotFoundError ||
          fatalErr instanceof RemoteFileUnavailableError ||
          fatalErr instanceof RemoteFileChangedError ||
          fatalErr instanceof InvalidPartialFileError) &&
        fs.existsSync(partialPath)
      ) {
        try {
          fs.unlinkSync(partialPath);
        } catch {
          // Ignore
        }
      }

      const statusErrorMessage = fatalErr instanceof ChecksumMismatchError ? 'CHECKSUM_MISMATCH' : errMsg;
      this.item.status = 'FAILED';
      this.item.errorMessage = statusErrorMessage;
      this.item.lastErrorCode = errCode;
      this.item.errorReason = errMsg;
      this.downloadsRepo.updateStatus(this.item.id, 'FAILED', statusErrorMessage, new Date().toISOString(), errCode);

      this.notifyStateChanged({
        downloadId: this.item.id,
        gameId: this.item.gameId,
        gameFileId: this.item.gameFileId,
        status: 'FAILED',
        error: errMsg,
        errorReason: errCode
      });
      throw fatalErr;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Pauses the active download, flushes stream, and preserves the partial file.
   */
  public async pause(): Promise<void> {
    if (!this.isRunning) {
      this.item.status = 'PAUSED';
      this.downloadsRepo.updateStatus(this.item.id, 'PAUSED', 'Paused by user');
      this.notifyStateChanged({
        downloadId: this.item.id,
        gameId: this.item.gameId,
        gameFileId: this.item.gameFileId,
        status: 'PAUSED'
      });
      return;
    }

    this.isPaused = true;
    this.abortController?.abort();
  }

  /**
   * Cancels the active download and removes any partial file on disk.
   */
  public async cancel(): Promise<void> {
    this.isCancelled = true;
    if (this.isRunning) {
      this.abortController?.abort();
    } else {
      const partialPath = this.item.partialPath || this.cacheManager.getPartialFilePath(this.item.id);
      if (fs.existsSync(partialPath)) {
        try {
          fs.unlinkSync(partialPath);
        } catch {
          // Ignore
        }
      }
      this.item.status = 'CANCELLED';
      this.downloadsRepo.updateStatus(this.item.id, 'CANCELLED', 'Cancelled by user', new Date().toISOString());
      this.notifyStateChanged({
        downloadId: this.item.id,
        gameId: this.item.gameId,
        gameFileId: this.item.gameFileId,
        status: 'CANCELLED'
      });
    }
  }

  /**
   * Validates checksum, atomically moves .part to destination, and updates records.
   */
  private async finalizeFile(
    partialPath: string,
    destinationPath: string,
    expectedMd5?: string
  ): Promise<void> {
    // 1. Verify Checksum if expected MD5 is present
    if (expectedMd5) {
      this.log.info(`Verifying MD5 checksum for download ${this.item.id} (Expected: ${expectedMd5})...`);
      const localMd5 = await calculateFileMd5(partialPath);
      if (localMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
        this.log.error(
          `Checksum mismatch for download ${this.item.id}: calculated ${localMd5} != expected ${expectedMd5}`
        );
        if (fs.existsSync(partialPath)) {
          try {
            fs.unlinkSync(partialPath);
          } catch {
            // Ignore
          }
        }
        throw new ChecksumMismatchError(
          `Checksum mismatch: expected ${expectedMd5}, calculated ${localMd5}`
        );
      }
      this.log.info(`MD5 checksum verified successfully for download ${this.item.id}.`);
    }

    // 2. Atomic Rename
    const finalDir = path.dirname(destinationPath);
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    await fs.promises.rename(partialPath, destinationPath);
    this.log.info(`Atomically finalized download ${this.item.id} -> ${destinationPath}`);

    // 3. Update Database States
    const now = new Date().toISOString();
    const stat = fs.statSync(destinationPath);
    const finalBytes = stat.size;

    if (this.item.gameFileId) {
      this.gameFilesRepo.updateStatus(this.item.gameFileId, 'CACHED_LOCAL', destinationPath);
    }

    this.item.status = 'COMPLETED';
    this.item.downloadedBytes = finalBytes;
    this.item.totalBytes = finalBytes;
    this.item.downloadSpeedBps = 0;
    this.item.completedAt = now;

    this.downloadsRepo.updateProgress(this.item.id, finalBytes, 0);
    this.downloadsRepo.updateStatus(this.item.id, 'COMPLETED', undefined, now);

    this.notifyProgress({
      downloadId: this.item.id,
      gameId: this.item.gameId,
      gameFileId: this.item.gameFileId,
      bytesTransferred: finalBytes,
      totalBytes: finalBytes,
      speedBps: 0,
      percentage: 100,
      status: 'COMPLETED',
      etaSeconds: 0
    });

    this.notifyStateChanged({
      downloadId: this.item.id,
      gameId: this.item.gameId,
      gameFileId: this.item.gameFileId,
      status: 'COMPLETED'
    });

    this.log.info(`Download ${this.item.id} completed successfully for game "${this.item.gameId}".`);
  }

  private notifyProgress(event: DownloadProgressEvent): void {
    if (this.onProgressCb) {
      try {
        this.onProgressCb(event);
      } catch (err) {
        this.log.error('Error in worker progress callback:', err);
      }
    }
  }

  private notifyStateChanged(event: DownloadStateChangedEvent): void {
    if (this.onStateChangedCb) {
      try {
        this.onStateChangedCb(event);
      } catch (err) {
        this.log.error('Error in worker state changed callback:', err);
      }
    }
  }
}
