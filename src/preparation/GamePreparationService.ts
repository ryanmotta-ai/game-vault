import fs from 'node:fs';
import path from 'node:path';
import {
  GameManifest,
  PreparationJob,
  PreparationJobStatus,
  PreparationProgressEvent
} from '../core/types';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { PreparationJobsRepository } from '../database/repositories/preparationJobsRepository';
import { GameManifestsRepository } from '../database/repositories/gameManifestsRepository';
import { SettingsRepository } from '../database/repositories/settingsRepository';
import { CacheManager } from '../storage/CacheManager';
import {
  ArchiveExtractorEngine,
  defaultArchiveExtractorEngine
} from './extractors/ArchiveExtractorEngine';
import {
  PlayableFileDetector,
  defaultPlayableFileDetector
} from './PlayableFileDetector';
import { LocalManifestService } from './LocalManifestService';
import {
  NotFoundError,
  InsufficientDiskSpaceError,
  PreparationError,
  ExtractionCancelledError
} from '../core/errors/AppError';
import { logger } from '../core/logger';

const DISK_SAFETY_MARGIN_BYTES = 512 * 1024 * 1024; // 512 MB

export interface GamePreparationServiceOptions {
  gamesRepo: GamesRepository;
  gameFilesRepo: GameFilesRepository;
  cacheManager: CacheManager;
  preparationJobsRepo?: PreparationJobsRepository;
  manifestsRepo?: GameManifestsRepository;
  manifestService?: LocalManifestService;
  settingsRepo?: SettingsRepository;
  extractorEngine?: ArchiveExtractorEngine;
  fileDetector?: PlayableFileDetector;
  onProgress?: (event: PreparationProgressEvent) => void;
}

export class GamePreparationService {
  private log = logger.child('GamePreparationService');
  private progressListeners = new Set<(event: PreparationProgressEvent) => void>();
  private activeJobs = new Map<string, { abortController: AbortController }>();

  private gamesRepo: GamesRepository;
  private gameFilesRepo: GameFilesRepository;
  private cacheManager: CacheManager;
  private preparationJobsRepo?: PreparationJobsRepository;
  private settingsRepo?: SettingsRepository;
  private extractorEngine: ArchiveExtractorEngine;
  private fileDetector: PlayableFileDetector;
  private manifestService: LocalManifestService;

  constructor(
    optionsOrGamesRepo: GamePreparationServiceOptions | GamesRepository,
    gameFilesRepo?: GameFilesRepository,
    cacheManager?: CacheManager,
    preparationJobsRepo?: PreparationJobsRepository,
    manifestsRepo?: GameManifestsRepository,
    settingsRepo?: SettingsRepository,
    extractorEngine: ArchiveExtractorEngine = defaultArchiveExtractorEngine,
    fileDetector: PlayableFileDetector = defaultPlayableFileDetector
  ) {
    if ('gamesRepo' in optionsOrGamesRepo) {
      const opts = optionsOrGamesRepo;
      this.gamesRepo = opts.gamesRepo;
      this.gameFilesRepo = opts.gameFilesRepo;
      this.cacheManager = opts.cacheManager;
      this.preparationJobsRepo = opts.preparationJobsRepo;
      this.settingsRepo = opts.settingsRepo;
      this.extractorEngine = opts.extractorEngine || defaultArchiveExtractorEngine;
      this.fileDetector = opts.fileDetector || defaultPlayableFileDetector;
      this.manifestService = opts.manifestService || new LocalManifestService(opts.manifestsRepo);
      if (opts.onProgress) {
        this.progressListeners.add(opts.onProgress);
      }
    } else {
      this.gamesRepo = optionsOrGamesRepo;
      this.gameFilesRepo = gameFilesRepo!;
      this.cacheManager = cacheManager!;
      this.preparationJobsRepo = preparationJobsRepo;
      this.settingsRepo = settingsRepo;
      this.extractorEngine = extractorEngine;
      this.fileDetector = fileDetector;
      this.manifestService = new LocalManifestService(manifestsRepo);
    }
  }

  public onProgress(listener: (event: PreparationProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private notifyProgress(event: PreparationProgressEvent): void {
    for (const listener of this.progressListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('Error in preparation progress listener:', err);
      }
    }
  }

  /**
   * Recovers any preparation left running when the app crashed or restarted.
   * Cleans orphan prepare directories and ensures game states are not stuck in PREPARING.
   */
  public recoverStalePreparationJobs(): number {
    this.log.info('Checking for stale preparation jobs and temporary folders on startup...');
    let recoveredCount = 0;

    // 1. Clean all orphaned temp prepare folders
    this.cacheManager.cleanTempPreparation();

    // 2. Query stale jobs from DB
    if (this.preparationJobsRepo) {
      const stale = this.preparationJobsRepo.getStaleJobs();
      for (const job of stale) {
        this.log.warn(`Recovering stale preparation job ${job.id} for game ${job.gameId}...`);
        this.preparationJobsRepo.fail(job.id, 'INTERRUPTED_BY_APP_EXIT');
        this.gamesRepo.updateState(job.gameId, 'CLOUD', null);
        recoveredCount++;
      }
    }

    // 3. Heal any game stuck in PREPARING
    const preparingGames = this.gamesRepo.getByState('PREPARING');
    for (const game of preparingGames) {
      this.log.warn(`Game "${game.title}" was left in PREPARING state. Reverting to CLOUD.`);
      this.gamesRepo.updateState(game.id, 'CLOUD', null);
      recoveredCount++;
    }

    return recoveredCount;
  }

  /**
   * Cancels an active preparation job.
   */
  public cancel(jobId: string): void {
    const active = this.activeJobs.get(jobId);
    if (active) {
      this.log.info(`Aborting preparation job: ${jobId}`);
      active.abortController.abort();
    }
  }

  /**
   * Prepares a downloaded game artifact for local playability.
   * Handles raw playable ROM fast-path or archive extraction into temporary sandbox.
   */
  public async prepare(gameId: string, signal?: AbortSignal): Promise<GameManifest> {
    if (!gameId || typeof gameId !== 'string') {
      throw new NotFoundError('Valid game ID is required for preparation.');
    }

    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found with ID: ${gameId}`);
    }

    const files = this.gameFilesRepo.getByGameId(gameId);
    if (files.length === 0) {
      throw new NotFoundError(`No files found for game "${game.title}" (${gameId}).`);
    }

    // Identify primary downloaded file
    const downloadedFile = files.find((f) => f.status === 'CACHED_LOCAL' && f.localPath && fs.existsSync(f.localPath));
    if (!downloadedFile || !downloadedFile.localPath) {
      throw new PreparationError(`No locally cached download file found for game "${game.title}".`);
    }

    const artifactPath = downloadedFile.localPath;
    const isArchive = this.extractorEngine.isSupportedArchive(artifactPath);

    const jobId = `prep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const abortController = new AbortController();
    this.activeJobs.set(jobId, { abortController });

    const combinedSignal = signal || abortController.signal;

    // Create DB PreparationJob record
    const job: PreparationJob = {
      id: jobId,
      gameId,
      status: 'QUEUED',
      step: 'Initializing',
      progressPercentage: 0,
      totalBytes: downloadedFile.sizeBytes,
      processedBytes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.preparationJobsRepo) {
      this.preparationJobsRepo.create(job);
    }

    // Transition game state to PREPARING
    this.gamesRepo.updateState(gameId, 'PREPARING', null);

    this.notifyProgress({
      jobId,
      gameId,
      status: 'QUEUED',
      step: 'Initializing preparation',
      progressPercentage: 0,
      totalBytes: downloadedFile.sizeBytes,
      processedBytes: 0
    });

    const finalGameDir = this.cacheManager.getGameCacheDir(gameId);
    let tempPrepareDir: string | null = null;

    try {
      if (combinedSignal.aborted) {
        throw new ExtractionCancelledError();
      }

      if (!isArchive) {
        // =========================================================================
        // FAST PATH: Raw Playable File (e.g. .chd, .iso, .rvz, .gba)
        // =========================================================================
        this.log.info(`Game "${game.title}" artifact is already raw playable (${path.extname(artifactPath)}). Fast path active.`);

        this.updateJobStep(jobId, 'VALIDATING', 'Validating playable file', 50);

        // Ensure file is in final game destination
        const safeName = path.basename(artifactPath);
        const destinationPath = path.join(finalGameDir, safeName);

        if (artifactPath.toLowerCase() !== destinationPath.toLowerCase()) {
          if (!fs.existsSync(finalGameDir)) {
            fs.mkdirSync(finalGameDir, { recursive: true });
          }
          await fs.promises.rename(artifactPath, destinationPath);
        }

        // Detect playable file
        const detection = this.fileDetector.detect(finalGameDir, game.platform, game.title);

        this.updateJobStep(jobId, 'FINALIZING', 'Generating local manifest', 90);

        const manifest: GameManifest = {
          gameId,
          title: game.title,
          platform: game.platform,
          preparedAt: new Date().toISOString(),
          primaryExecutableOrRom: path.basename(detection.primaryFilePath),
          totalLocalSize: detection.requiredFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
          installRequired: detection.installRequired,
          files: detection.requiredFiles,
          sourceArtifactIds: files.map((f) => f.id),
          integrityStatus: 'VERIFIED'
        };

        await this.manifestService.saveManifest(manifest, finalGameDir);

        // Update database records
        this.gameFilesRepo.updateStatus(downloadedFile.id, 'CACHED_LOCAL', destinationPath);
        this.gamesRepo.updateState(gameId, 'READY', detection.primaryFilePath);
        this.gamesRepo.updateLastAccessed(gameId);

        if (this.preparationJobsRepo) {
          this.preparationJobsRepo.complete(jobId, detection.primaryFilePath);
        }

        this.notifyProgress({
          jobId,
          gameId,
          status: 'COMPLETED',
          step: 'Ready to play',
          progressPercentage: 100,
          totalBytes: manifest.totalLocalSize,
          processedBytes: manifest.totalLocalSize
        });

        this.log.info(`Preparation complete for "${game.title}". Game is READY.`);
        return manifest;
      }

      // =========================================================================
      // ARCHIVE PATH: Extraction, Sandbox, Validation & Atomic Rename
      // =========================================================================
      this.log.info(`Preparing archive for game "${game.title}": ${artifactPath}`);

      // 1. Pre-flight Disk Space Check
      const availableSpace = this.cacheManager.getAvailableDiskSpace();
      const extractedEstimate = await this.extractorEngine.estimateExtractionSize(artifactPath);
      const estimatedUncompressed = Math.max(extractedEstimate, downloadedFile.sizeBytes);
      const requiredBytes = estimatedUncompressed + DISK_SAFETY_MARGIN_BYTES;

      if (availableSpace < requiredBytes) {
        throw new InsufficientDiskSpaceError(
          `Insufficient disk space for extraction. Required: ${(requiredBytes / 1024 / 1024).toFixed(1)} MB, Available: ${(availableSpace / 1024 / 1024).toFixed(1)} MB.`
        );
      }

      // 2. Prepare Sandbox Directory
      tempPrepareDir = this.cacheManager.getTempPrepareDir(jobId);
      if (fs.existsSync(tempPrepareDir)) {
        this.cacheManager.safeDelete(tempPrepareDir);
      }
      fs.mkdirSync(tempPrepareDir, { recursive: true });

      // 3. Extraction Step
      this.updateJobStep(jobId, 'EXTRACTING', 'Extracting archive...', 10, estimatedUncompressed);

      await this.extractorEngine.extract(artifactPath, tempPrepareDir, {
        signal: combinedSignal,
        onProgress: (progress) => {
          const scaledPercent = Math.min(85, Math.round(10 + (progress.percentage * 0.75)));
          this.updateJobProgress(
            jobId,
            'EXTRACTING',
            `Extracting... ${progress.percentage}%`,
            scaledPercent,
            progress.processedBytes,
            progress.totalBytes
          );
        }
      });

      if (combinedSignal.aborted) {
        throw new ExtractionCancelledError();
      }

      // 4. Validation Step: Detect Playable Files
      this.updateJobStep(jobId, 'VALIDATING', 'Validating playable files...', 88);
      const detection = this.fileDetector.detect(tempPrepareDir, game.platform, game.title);

      this.log.info(
        `Detected primary file "${detection.primaryRelativePath}" for platform ${detection.platform} (Required files: ${detection.requiredFiles.length})`
      );

      // 5. Finalizing Step: Atomic Rename & Manifest Creation
      this.updateJobStep(jobId, 'FINALIZING', 'Finalizing game directory...', 95);

      if (fs.existsSync(finalGameDir)) {
        this.cacheManager.safeDelete(finalGameDir);
      }

      // Atomic rename sandbox -> destination
      fs.renameSync(tempPrepareDir, finalGameDir);
      tempPrepareDir = null; // Cleaned up via rename

      const finalPrimaryPath = path.join(finalGameDir, detection.primaryRelativePath);

      // Calculate total local size
      let totalLocalSize = 0;
      const finalManifestFiles = detection.requiredFiles.map((f) => {
        const fullP = path.join(finalGameDir, f.relativePath);
        const st = fs.existsSync(fullP) ? fs.statSync(fullP) : null;
        const sz = st ? st.size : f.sizeBytes;
        totalLocalSize += sz;
        return {
          ...f,
          path: fullP,
          sizeBytes: sz
        };
      });

      const manifest: GameManifest = {
        gameId,
        title: game.title,
        platform: game.platform,
        preparedAt: new Date().toISOString(),
        primaryExecutableOrRom: detection.primaryRelativePath,
        totalLocalSize,
        installRequired: detection.installRequired,
        files: finalManifestFiles,
        sourceArtifactIds: files.map((f) => f.id),
        integrityStatus: 'VERIFIED'
      };

      await this.manifestService.saveManifest(manifest, finalGameDir);

      // 6. Archive Retention Policy
      const keepVal = this.settingsRepo?.get<boolean | string>('keep_original_archives');
      const keepArchives = keepVal === true || keepVal === 'true';
      if (!keepArchives) {
        if (fs.existsSync(artifactPath)) {
          try {
            fs.unlinkSync(artifactPath);
            this.log.info(`Deleted source archive ${artifactPath} per retention policy (keep_original_archives=false).`);
          } catch (err) {
            this.log.warn(`Could not delete source archive ${artifactPath}:`, err);
          }
        }
      } else {
        this.log.info(`Preserving source archive ${artifactPath} (keep_original_archives=true).`);
      }

      // 7. Update Database States
      this.gameFilesRepo.updateStatus(downloadedFile.id, 'CACHED_LOCAL', finalPrimaryPath);
      this.gamesRepo.updateState(gameId, 'READY', finalPrimaryPath);
      this.gamesRepo.updateLastAccessed(gameId);

      if (this.preparationJobsRepo) {
        this.preparationJobsRepo.complete(jobId, finalPrimaryPath);
      }

      this.notifyProgress({
        jobId,
        gameId,
        status: 'COMPLETED',
        step: 'Ready to play',
        progressPercentage: 100,
        totalBytes: totalLocalSize,
        processedBytes: totalLocalSize
      });

      this.log.info(`Successfully prepared game "${game.title}" (${gameId}). Game is now READY.`);
      return manifest;
    } catch (err: unknown) {
      // 8. Safe Cleanup on Failure
      if (tempPrepareDir && fs.existsSync(tempPrepareDir)) {
        try {
          this.cacheManager.safeDelete(tempPrepareDir);
        } catch {
          // Ignore
        }
      }

      const isCancelled = combinedSignal.aborted || err instanceof ExtractionCancelledError;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (isCancelled) {
        this.log.warn(`Preparation job ${jobId} for game ${gameId} was CANCELLED.`);
        if (this.preparationJobsRepo) {
          this.preparationJobsRepo.cancel(jobId);
        }
        this.gamesRepo.updateState(gameId, 'CLOUD', null);
        this.notifyProgress({
          jobId,
          gameId,
          status: 'CANCELLED',
          step: 'Cancelled by user',
          progressPercentage: 0,
          totalBytes: 0,
          processedBytes: 0
        });
        throw err;
      }

      this.log.error(`Preparation failed for game "${game.title}" (${gameId}):`, err);

      if (this.preparationJobsRepo) {
        this.preparationJobsRepo.fail(jobId, errMsg);
      }

      // Update state to ERROR so game reflects extraction failure and never reaches READY
      this.gamesRepo.updateState(gameId, 'ERROR', null);

      this.notifyProgress({
        jobId,
        gameId,
        status: 'FAILED',
        step: errMsg,
        progressPercentage: 0,
        totalBytes: 0,
        processedBytes: 0,
        message: errMsg
      });

      throw err;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private updateJobStep(
    jobId: string,
    status: PreparationJobStatus,
    step: string,
    percentage: number,
    totalBytes?: number
  ): void {
    if (this.preparationJobsRepo) {
      this.preparationJobsRepo.updateProgress(jobId, status, step, percentage, 0, totalBytes);
    }
    const active = this.preparationJobsRepo?.getById(jobId);
    this.notifyProgress({
      jobId,
      gameId: active?.gameId || '',
      status,
      step,
      progressPercentage: percentage,
      totalBytes: totalBytes || active?.totalBytes || 0,
      processedBytes: 0
    });
  }

  private updateJobProgress(
    jobId: string,
    status: PreparationJobStatus,
    step: string,
    percentage: number,
    processedBytes: number,
    totalBytes: number
  ): void {
    if (this.preparationJobsRepo) {
      this.preparationJobsRepo.updateProgress(jobId, status, step, percentage, processedBytes, totalBytes);
    }
    const active = this.preparationJobsRepo?.getById(jobId);
    this.notifyProgress({
      jobId,
      gameId: active?.gameId || '',
      status,
      step,
      progressPercentage: percentage,
      totalBytes,
      processedBytes
    });
  }

  public async prepareGame(gameId: string, signal?: AbortSignal): Promise<GameManifest> {
    return this.prepare(gameId, signal);
  }
}
