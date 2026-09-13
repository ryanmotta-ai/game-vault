import fs from 'node:fs';
import { DownloadProgressEvent, DownloadStateChangedEvent } from '../core/types';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { StorageManager } from '../storage/StorageManager';
import { CacheManager } from '../storage/CacheManager';
import { DownloadWorker } from './DownloadWorker';
import { logger } from '../core/logger';

export class DownloadScheduler {
  private log = logger.child('DownloadScheduler');
  private maxConcurrent = 2; // Default 2 concurrent download slots
  private activeWorkers = new Map<string, DownloadWorker>();
  private isProcessing = false;

  private onProgressCb?: (event: DownloadProgressEvent) => void;
  private onStateChangedCb?: (event: DownloadStateChangedEvent) => void;

  constructor(
    private downloadsRepo: DownloadsRepository,
    private gameFilesRepo: GameFilesRepository,
    private storageManager: StorageManager,
    private cacheManager: CacheManager
  ) {}

  public setCallbacks(
    onProgress: (event: DownloadProgressEvent) => void,
    onStateChanged: (event: DownloadStateChangedEvent) => void
  ): void {
    this.onProgressCb = onProgress;
    this.onStateChangedCb = onStateChanged;
  }

  public setMaxConcurrent(slots: number): void {
    this.maxConcurrent = Math.max(1, Math.min(slots, 4));
    this.log.info(`Concurrency limit set to ${this.maxConcurrent} active download(s).`);
    setImmediate(() => this.dispatchNext().catch((err) => this.log.error('Dispatch error:', err)));
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  public getActiveCount(): number {
    return this.activeWorkers.size;
  }

  public isBusy(): boolean {
    return this.activeWorkers.size >= this.maxConcurrent;
  }

  /**
   * Main dispatch loop: checks available slots and starts highest-priority QUEUED items.
   */
  public async dispatchNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.activeWorkers.size < this.maxConcurrent) {
        const nextItem = this.downloadsRepo.getNextQueued();
        if (!nextItem) break;

        // Skip if already active
        if (this.activeWorkers.has(nextItem.id)) {
          break;
        }

        // Spawn worker for this download slot
        const worker = new DownloadWorker({
          item: nextItem,
          downloadsRepo: this.downloadsRepo,
          gameFilesRepo: this.gameFilesRepo,
          storageManager: this.storageManager,
          cacheManager: this.cacheManager,
          onProgress: (progress) => {
            this.onProgressCb?.(progress);
          },
          onStateChanged: (stateEvent) => {
            this.onStateChangedCb?.(stateEvent);
            if (
              stateEvent.status === 'COMPLETED' ||
              stateEvent.status === 'FAILED' ||
              stateEvent.status === 'CANCELLED' ||
              stateEvent.status === 'PAUSED'
            ) {
              this.activeWorkers.delete(stateEvent.downloadId);
              // Immediately dispatch next queued item when a slot is freed
              setImmediate(() => this.dispatchNext().catch((err) => this.log.error('Dispatch error:', err)));
            }
          }
        });

        this.activeWorkers.set(nextItem.id, worker);
        this.log.info(
          `Allocated slot (${this.activeWorkers.size}/${this.maxConcurrent}) for download ${nextItem.id} (File: ${nextItem.gameFileId})`
        );

        // Start worker asynchronously
        worker
          .start()
          .catch((err) => {
            this.log.error(`Worker error for ${nextItem.id}:`, err);
          })
          .finally(() => {
            this.activeWorkers.delete(nextItem.id);
            setImmediate(() => this.dispatchNext().catch((e) => this.log.error('Dispatch error:', e)));
          });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Pauses an active download, freeing its concurrency slot immediately.
   */
  public async pause(downloadId: string): Promise<void> {
    this.log.info(`Pausing download ${downloadId}...`);
    const worker = this.activeWorkers.get(downloadId);
    if (worker) {
      this.activeWorkers.delete(downloadId);
      await worker.pause();
    } else {
      const item = this.downloadsRepo.getById(downloadId);
      if (item && (item.status === 'QUEUED' || item.status === 'DOWNLOADING')) {
        this.downloadsRepo.updateStatus(downloadId, 'PAUSED', 'Paused by user');
        this.onStateChangedCb?.({
          downloadId,
          gameId: item.gameId,
          gameFileId: item.gameFileId,
          status: 'PAUSED'
        });
      }
    }

    // Free slot: dispatch next queued item
    setImmediate(() => this.dispatchNext().catch((err) => this.log.error('Dispatch error:', err)));
  }

  /**
   * Resumes a paused download.
   */
  public async resume(downloadId: string): Promise<void> {
    this.log.info(`Resuming download ${downloadId}...`);
    const item = this.downloadsRepo.getById(downloadId);
    if (!item) return;

    if (item.status === 'COMPLETED') return;

    // Transition back to QUEUED
    item.status = 'QUEUED';
    this.downloadsRepo.upsert(item);

    this.onStateChangedCb?.({
      downloadId,
      gameId: item.gameId,
      gameFileId: item.gameFileId,
      status: 'QUEUED'
    });

    // Attempt to allocate slot or queue
    await this.dispatchNext();
  }

  /**
   * Cancels a download.
   */
  public async cancel(downloadId: string): Promise<void> {
    this.log.info(`Cancelling download ${downloadId}...`);
    const worker = this.activeWorkers.get(downloadId);
    if (worker) {
      this.activeWorkers.delete(downloadId);
      await worker.cancel();
    } else {
      const item = this.downloadsRepo.getById(downloadId);
      if (item) {
        if (item.partialPath && fs.existsSync(item.partialPath)) {
          try {
            fs.unlinkSync(item.partialPath);
          } catch {
            // Ignore
          }
        }
        this.downloadsRepo.updateStatus(downloadId, 'CANCELLED', 'Cancelled by user', new Date().toISOString());
        this.onStateChangedCb?.({
          downloadId,
          gameId: item.gameId,
          gameFileId: item.gameFileId,
          status: 'CANCELLED'
        });
      }
    }

    // Free slot: dispatch next queued item
    setImmediate(() => this.dispatchNext().catch((err) => this.log.error('Dispatch error:', err)));
  }

  /**
   * Moves a download to the top of the queue ("Download Next").
   */
  public prioritize(downloadId: string): void {
    const item = this.downloadsRepo.getById(downloadId);
    if (!item) return;

    const maxP = this.downloadsRepo.getMaxPriority();
    const newPriority = maxP + 1;
    this.downloadsRepo.updatePriority(downloadId, newPriority);
    this.log.info(`Prioritized download ${downloadId} with priority ${newPriority} ("Download Next")`);

    setImmediate(() => this.dispatchNext().catch((err) => this.log.error('Dispatch error:', err)));
  }

  /**
   * Graceful shutdown on app quit: pauses active downloads and persists offsets.
   */
  public async shutdown(): Promise<void> {
    this.log.info(`Shutting down scheduler. Pausing ${this.activeWorkers.size} active download(s)...`);
    const workers = Array.from(this.activeWorkers.values());
    this.activeWorkers.clear();

    await Promise.all(
      workers.map(async (worker) => {
        try {
          await worker.pause();
        } catch (err) {
          this.log.warn(`Error pausing worker ${worker.downloadId} during shutdown:`, err);
        }
      })
    );
  }
}
