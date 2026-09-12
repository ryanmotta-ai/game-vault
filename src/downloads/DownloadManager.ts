import { DownloadItem } from '../core/types';
import { DownloadProgressEvent, DownloadTaskRequest } from './types';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { logger } from '../core/logger';
import { NotImplementedError } from '../core/errors/AppError';

export class DownloadManager {
  private log = logger.child('DownloadManager');
  private listeners = new Set<(event: DownloadProgressEvent) => void>();

  constructor(
    private downloadsRepo: DownloadsRepository,
    private gamesRepo: GamesRepository
  ) {}

  public onProgress(listener: (event: DownloadProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notifyProgress(event: DownloadProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('Error in download progress listener:', err);
      }
    }
  }

  public async queueDownload(request: DownloadTaskRequest): Promise<DownloadItem> {
    this.log.info(`Queueing download for game ${request.gameId}`);
    const downloadId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const game = this.gamesRepo.getById(request.gameId);

    const item: DownloadItem = {
      id: downloadId,
      gameId: request.gameId,
      gameFileId: request.gameFileId,
      storageAccountId: request.storageAccountId,
      status: 'QUEUED',
      totalBytes: game?.sizeBytes || 0,
      downloadedBytes: 0,
      downloadSpeedBps: 0,
      createdAt: new Date().toISOString()
    };

    this.downloadsRepo.upsert(item);
    this.gamesRepo.updateState(request.gameId, 'DOWNLOADING');

    return item;
  }

  public async pauseDownload(_downloadId: string): Promise<void> {
    throw new NotImplementedError('DownloadManager.pauseDownload (Phase 3)');
  }

  public async resumeDownload(_downloadId: string): Promise<void> {
    throw new NotImplementedError('DownloadManager.resumeDownload (Phase 3)');
  }

  public async cancelDownload(downloadId: string): Promise<void> {
    const item = this.downloadsRepo.getById(downloadId);
    if (item) {
      this.downloadsRepo.upsert({
        ...item,
        status: 'CANCELLED',
        completedAt: new Date().toISOString()
      });
      this.gamesRepo.updateState(item.gameId, 'CLOUD');
    }
  }

  public getActiveDownloads(): DownloadItem[] {
    return this.downloadsRepo.getActive();
  }

  public getAllDownloads(): DownloadItem[] {
    return this.downloadsRepo.getAll();
  }
}
