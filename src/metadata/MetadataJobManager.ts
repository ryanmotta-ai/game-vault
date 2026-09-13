import crypto from 'node:crypto';
import { logger } from '../core/logger';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import {
  MetadataJobsRepository,
  MetadataJobRecord,
  MetadataJobPriority
} from '../database/repositories/metadataJobsRepository';
import { MetadataProviderRegistry } from './MetadataProviderRegistry';
import { MetadataMergeService } from './MetadataMergeService';
import { ArtworkCacheManager } from './ArtworkCacheManager';
import { GameIdentificationService } from './GameIdentificationService';
import { MetadataMatchResolver } from './MetadataMatchResolver';
import { MetadataProgressEvent } from './types';

export interface MetadataJobManagerOptions {
  jobsRepo: MetadataJobsRepository;
  gamesRepo: GamesRepository;
  gameFilesRepo?: GameFilesRepository;
  providerRegistry: MetadataProviderRegistry;
  mergeService: MetadataMergeService;
  artworkCache: ArtworkCacheManager;
  preferredProviderId?: string;
  maxConcurrentJobs?: number;
  onProgress?: (event: MetadataProgressEvent) => void;
}

export class MetadataJobManager {
  private log = logger.child('MetadataJobManager');
  private jobsRepo: MetadataJobsRepository;
  private gamesRepo: GamesRepository;
  private gameFilesRepo?: GameFilesRepository;
  private providerRegistry: MetadataProviderRegistry;
  private mergeService: MetadataMergeService;
  private artworkCache: ArtworkCacheManager;
  private preferredProviderId?: string;
  private maxConcurrentJobs: number;
  private activeJobsCount = 0;
  private isRunning = false;
  private pollInterval?: NodeJS.Timeout;
  private onProgressCallback?: (event: MetadataProgressEvent) => void;

  constructor(options: MetadataJobManagerOptions) {
    this.jobsRepo = options.jobsRepo;
    this.gamesRepo = options.gamesRepo;
    this.gameFilesRepo = options.gameFilesRepo;
    this.providerRegistry = options.providerRegistry;
    this.mergeService = options.mergeService;
    this.artworkCache = options.artworkCache;
    this.preferredProviderId = options.preferredProviderId;
    this.maxConcurrentJobs = options.maxConcurrentJobs || 2;
    this.onProgressCallback = options.onProgress;
  }

  public setPreferredProviderId(providerId?: string): void {
    this.preferredProviderId = providerId;
  }

  public setOnProgress(cb: (event: MetadataProgressEvent) => void): void {
    this.onProgressCallback = cb;
  }

  /**
   * Resets any jobs that were interrupted mid-execution (crash recovery).
   */
  public recoverStaleJobs(): number {
    const recovered = this.jobsRepo.recoverStaleJobs();
    if (recovered > 0) {
      this.log.info(`Recovered ${recovered} stale metadata jobs back to QUEUED.`);
    }
    return recovered;
  }

  /**
   * Enqueues a metadata job for a specific game.
   */
  public enqueueGame(
    gameId: string,
    priority: MetadataJobPriority = 'NORMAL'
  ): MetadataJobRecord {
    const existing = this.jobsRepo.getByGameId(gameId);
    if (existing && ['QUEUED', 'SEARCHING', 'DOWNLOADING_MEDIA'].includes(existing.status)) {
      if (priority === 'USER_REQUESTED' && existing.priority !== 'USER_REQUESTED') {
        const upgraded: MetadataJobRecord = {
          ...existing,
          priority: 'USER_REQUESTED',
          updatedAt: new Date().toISOString()
        };
        this.jobsRepo.upsert(upgraded);
        return upgraded;
      }
      return existing;
    }

    const job: MetadataJobRecord = {
      id: crypto.randomUUID(),
      gameId,
      status: 'QUEUED',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.jobsRepo.upsert(job);
    this.log.debug(`Enqueued metadata job ${job.id} for game ${gameId} (priority: ${priority})`);

    this.notifyProgress({
      current: 0,
      total: 1,
      gameId,
      title: gameId,
      status: 'queued'
    });

    if (this.isRunning) {
      this.processQueue().catch((err) => this.log.error('Error in processQueue:', err));
    }

    return job;
  }

  /**
   * Enqueues all games or all unscraped games for metadata retrieval.
   */
  public enqueueAllGames(priority: MetadataJobPriority = 'BACKGROUND', onlyUnscraped = true): number {
    const games = onlyUnscraped
      ? this.gamesRepo.getUnscrapedGames()
      : this.gamesRepo.getAll();

    let enqueued = 0;
    for (const g of games) {
      this.enqueueGame(g.id, priority);
      enqueued++;
    }

    this.log.info(`Enqueued ${enqueued} games for background metadata retrieval.`);
    return enqueued;
  }

  public getJobForGame(gameId: string): MetadataJobRecord | null {
    return this.jobsRepo.getByGameId(gameId);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.recoverStaleJobs();
    this.log.info('MetadataJobManager background queue started.');

    this.pollInterval = setInterval(() => {
      this.processQueue().catch((err) => this.log.error('Error during scheduled queue processing:', err));
    }, 2000);

    this.processQueue().catch((err) => this.log.error('Error starting initial processQueue:', err));
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.log.info('MetadataJobManager background queue stopped.');
  }

  /**
   * Runs the processing loop while worker slots are available.
   */
  public async processQueue(): Promise<void> {
    while (this.activeJobsCount < this.maxConcurrentJobs) {
      const nextJob = this.jobsRepo.getNextQueuedJob();
      if (!nextJob) break;

      this.activeJobsCount++;
      this.executeJob(nextJob)
        .catch((err) => {
          this.log.error(`Unhandled error in executeJob for ${nextJob.gameId}:`, err);
        })
        .finally(() => {
          this.activeJobsCount--;
          if (this.isRunning) {
            this.processQueue().catch(() => {});
          }
        });
    }
  }

  /**
   * Executes a single metadata job through all pipeline stages.
   */
  public async executeJob(job: MetadataJobRecord): Promise<void> {
    const game = this.gamesRepo.getById(job.gameId);
    if (!game) {
      this.log.warn(`Game ${job.gameId} not found, cancelling job ${job.id}`);
      this.jobsRepo.updateStatus(job.id, 'CANCELLED', 'Game no longer exists in database');
      return;
    }

    this.log.info(`Executing metadata job ${job.id} for '${game.title}'`);
    this.jobsRepo.updateStatus(job.id, 'SEARCHING');

    this.notifyProgress({
      current: 1,
      total: 1,
      gameId: game.id,
      title: game.title,
      status: 'searching'
    });

    try {
      // Step 1: Identification
      let primaryFile;
      if (this.gameFilesRepo) {
        const files = this.gameFilesRepo.getByGameId(game.id);
        primaryFile = files.find((f) => !f.filename.endsWith('.cue')) || files[0];
      }

      const identity = GameIdentificationService.identify(game, primaryFile);

      // Step 2: Query candidate metadata across providers
      const candidates = await this.providerRegistry.searchCandidates(
        identity,
        this.preferredProviderId
      );

      if (!candidates || candidates.length === 0) {
        this.log.info(`No metadata candidates found for '${game.title}' (${game.id})`);
        this.jobsRepo.updateStatus(job.id, 'SKIPPED', 'No matching metadata found');
        this.notifyProgress({
          current: 1,
          total: 1,
          gameId: game.id,
          title: game.title,
          status: 'skipped'
        });
        return;
      }

      // Step 3: Match resolution
      const resolution = MetadataMatchResolver.resolve(candidates);
      const best = resolution.bestMatch;

      if (!best) {
        this.jobsRepo.updateStatus(job.id, 'SKIPPED', resolution.reason);
        return;
      }

      this.jobsRepo.upsert({
        ...job,
        providerId: best.provider,
        confidence: resolution.confidence
      });

      // Step 4: Branching on confidence
      if (resolution.requiresReview) {
        this.log.info(`Match for '${game.title}' requires user review (${resolution.reason})`);
        this.mergeService.applyCandidate(game.id, best, { status: 'REVIEW_REQUIRED' });
        this.jobsRepo.updateStatus(job.id, 'REVIEW_REQUIRED', resolution.reason);

        this.notifyProgress({
          current: 1,
          total: 1,
          gameId: game.id,
          title: game.title,
          status: 'review_required',
          confidence: resolution.confidence
        });
        return;
      }

      // Step 5: Confident match - apply metadata and download artwork
      this.jobsRepo.updateStatus(job.id, 'DOWNLOADING_MEDIA');
      this.notifyProgress({
        current: 1,
        total: 1,
        gameId: game.id,
        title: game.title,
        status: 'downloading_media',
        confidence: resolution.confidence
      });

      this.mergeService.applyCandidate(game.id, best, { status: 'MATCHED' });

      // Step 6: Download & Cache Artwork
      await this.downloadArtworkAssets(game.id, best);

      this.jobsRepo.updateStatus(job.id, 'COMPLETED');
      this.notifyProgress({
        current: 1,
        total: 1,
        gameId: game.id,
        title: game.title,
        status: 'completed',
        confidence: resolution.confidence
      });

      this.log.info(`Metadata job ${job.id} completed successfully for '${game.title}'`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`Metadata job ${job.id} failed for game ${game.id}:`, err);
      this.jobsRepo.updateStatus(job.id, 'FAILED', msg);
      this.notifyProgress({
        current: 1,
        total: 1,
        gameId: game.id,
        title: game.title,
        status: 'failed',
        error: msg
      });
    }
  }

  private async downloadArtworkAssets(gameId: string, candidate: any): Promise<void> {
    const downloads: Promise<any>[] = [];

    if (candidate.coverUrl) {
      downloads.push(
        this.artworkCache.downloadAndCache({
          gameId,
          remoteUrl: candidate.coverUrl,
          assetType: 'cover',
          provider: candidate.provider,
          isPrimary: true
        })
      );
    }

    if (candidate.logoUrl) {
      downloads.push(
        this.artworkCache.downloadAndCache({
          gameId,
          remoteUrl: candidate.logoUrl,
          assetType: 'logo',
          provider: candidate.provider,
          isPrimary: true
        })
      );
    }

    if (candidate.backgroundUrl) {
      downloads.push(
        this.artworkCache.downloadAndCache({
          gameId,
          remoteUrl: candidate.backgroundUrl,
          assetType: 'banner',
          provider: candidate.provider,
          isPrimary: true
        })
      );
    }

    if (candidate.screenshotUrls && Array.isArray(candidate.screenshotUrls)) {
      const screens = candidate.screenshotUrls.slice(0, 4);
      screens.forEach((url: string, idx: number) => {
        downloads.push(
          this.artworkCache.downloadAndCache({
            gameId,
            remoteUrl: url,
            assetType: 'screenshot',
            index: idx,
            provider: candidate.provider
          })
        );
      });
    }

    await Promise.allSettled(downloads);
  }

  private notifyProgress(event: MetadataProgressEvent): void {
    if (this.onProgressCallback) {
      try {
        this.onProgressCallback(event);
      } catch {}
    }
  }
}
