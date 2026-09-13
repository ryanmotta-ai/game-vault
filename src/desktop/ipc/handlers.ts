import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { GamesRepository } from '../../database/repositories/gamesRepository';
import { StorageAccountsRepository } from '../../database/repositories/storageAccountsRepository';
import { DownloadsRepository } from '../../database/repositories/downloadsRepository';
import { SettingsRepository } from '../../database/repositories/settingsRepository';
import { CloudFilesRepository } from '../../database/repositories/cloudFilesRepository';
import { SyncStateRepository } from '../../database/repositories/syncStateRepository';
import { CatalogIngestionService } from '../../catalog/CatalogIngestionService';
import { SyncCoordinator } from '../../sync/SyncCoordinator';
import { StorageManager } from '../../storage/StorageManager';
import { CacheManager } from '../../storage/CacheManager';
import { DownloadManager } from '../../downloads/DownloadManager';
import { GameState, StorageProviderType } from '../../core/types';
import { logger } from '../../core/logger';
import { AppError, ValidationError } from '../../core/errors/AppError';
<<<<<<< Updated upstream
=======
import { IntegrationManager } from '../../integrations/IntegrationManager';
import { registerIntegrationHandlers } from './integrationHandlers';
import { MetadataService, ArtworkCacheManager, MetadataProviderRegistry, MetadataMergeService, MetadataJobManager } from '../../metadata';
import { GameMetadataRepository } from '../../database/repositories/gameMetadataRepository';
import { GameMetadataSourcesRepository } from '../../database/repositories/gameMetadataSourcesRepository';
import { GameArtworkRepository } from '../../database/repositories/gameArtworkRepository';
import { MetadataJobsRepository } from '../../database/repositories/metadataJobsRepository';
import { GameArtworkType } from '../../core/types';
>>>>>>> Stashed changes

export interface IpcContext {
  gamesRepo: GamesRepository;
  accountsRepo: StorageAccountsRepository;
  downloadsRepo: DownloadsRepository;
  settingsRepo: SettingsRepository;
  cloudFilesRepo: CloudFilesRepository;
  syncStateRepo: SyncStateRepository;
  catalogIngestion: CatalogIngestionService;
  syncCoordinator: SyncCoordinator;
  storageManager: StorageManager;
  cacheManager: CacheManager;
  downloadManager: DownloadManager;
<<<<<<< Updated upstream
=======
  preparationService?: GamePreparationService;
  preparationJobsRepo?: PreparationJobsRepository;
  gameManifestsRepo?: GameManifestsRepository;
  launchProfilesRepo?: LaunchProfilesRepository;
  emulatorsRepo?: EmulatorsRepository;
  gameSessionsRepo?: GameSessionsRepository;
  launcherManager?: LauncherManager;
  instantHydrationService?: InstantHydrationService;
  strategyResolver?: PlaybackStrategyResolver;
  integrationManager?: IntegrationManager;
  metadataService?: MetadataService;
  artworkCacheManager?: ArtworkCacheManager;
  metadataRepo?: GameMetadataRepository;
  metadataSourcesRepo?: GameMetadataSourcesRepository;
  metadataArtworkRepo?: GameArtworkRepository;
  metadataJobsRepo?: MetadataJobsRepository;
  providerRegistry?: MetadataProviderRegistry;
  mergeService?: MetadataMergeService;
  jobManager?: MetadataJobManager;
>>>>>>> Stashed changes
  mainWindow: BrowserWindow;
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const log = logger.child('IPC');

  function wrapHandler<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (...args: TArgs) => Promise<TResult> | TResult
  ): void {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        log.debug(`IPC Invoke [${channel}]`);
        return await handler(...(args as TArgs));
      } catch (err) {
        log.error(`Error in IPC handler [${channel}]:`, err);
        if (err instanceof AppError) {
          return { error: err.toJSON() };
        }
        return {
          error: {
            name: 'InternalError',
            message: err instanceof Error ? err.message : 'Unknown internal error',
            code: 'INTERNAL_ERROR'
          }
        };
      }
    });
  }

  // --- Games Handlers ---
  wrapHandler(IPC_CHANNELS.GAMES_GET_ALL, () => {
    return ctx.gamesRepo.getAll();
  });

  wrapHandler(IPC_CHANNELS.GAMES_GET_BY_ID, (id: string) => {
    return ctx.gamesRepo.getById(id);
  });

  wrapHandler(IPC_CHANNELS.GAMES_GET_BY_STATE, (state: GameState) => {
    return ctx.gamesRepo.getByState(state);
  });

  wrapHandler(IPC_CHANNELS.GAMES_UPDATE_STATE, (id: string, state: GameState, installedPath?: string) => {
    ctx.gamesRepo.updateState(id, state, installedPath);
    return ctx.gamesRepo.getById(id);
  });

  // --- Storage & Accounts Handlers ---
  wrapHandler(IPC_CHANNELS.STORAGE_GET_ACCOUNTS, () => {
    return ctx.accountsRepo.getAll();
  });

  wrapHandler(IPC_CHANNELS.STORAGE_CONNECT_ACCOUNT, async (accountData: { name?: string; type: StorageProviderType }) => {
    if (!accountData || !accountData.type) {
      throw new ValidationError('Storage provider type is required.');
    }
    return await ctx.storageManager.connectAccount(accountData.type, accountData.name);
  });

  wrapHandler(IPC_CHANNELS.STORAGE_DISCONNECT_ACCOUNT, async (accountId: string) => {
    if (!accountId || typeof accountId !== 'string') {
      throw new ValidationError('Valid account ID is required.');
    }
    await ctx.storageManager.disconnectAccount(accountId);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.STORAGE_RECONNECT_ACCOUNT, async (accountId: string) => {
    if (!accountId || typeof accountId !== 'string') {
      throw new ValidationError('Valid account ID is required.');
    }
    return await ctx.storageManager.reconnectAccount(accountId);
  });

  wrapHandler(IPC_CHANNELS.STORAGE_GET_QUOTA_SUMMARY, async () => {
    const accounts = ctx.accountsRepo.getAll();
    return await ctx.storageManager.getQuotaSummary(accounts);
  });

  wrapHandler(IPC_CHANNELS.STORAGE_CLEAR_CACHE, () => {
    ctx.cacheManager.clearCache();
    const accounts = ctx.accountsRepo.getAll();
    return ctx.storageManager.getQuotaSummary(accounts);
  });

  wrapHandler(IPC_CHANNELS.STORAGE_LIST_FILES, async (accountId: string, folderId?: string) => {
    if (!accountId || typeof accountId !== 'string') {
      throw new ValidationError('Valid account ID is required.');
    }
    const provider = ctx.storageManager.getProvider(accountId);
    return await provider.listFiles(folderId);
  });

  // --- Sync & Cloud Inventory Handlers ---
  ctx.syncCoordinator.onProgress((progress) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(IPC_CHANNELS.SYNC_PROGRESS_EVENT, progress);
    }
  });

  wrapHandler(IPC_CHANNELS.SYNC_SCAN_ACCOUNT, async (accountId: string) => {
    if (!accountId || typeof accountId !== 'string') {
      throw new ValidationError('Valid account ID is required for sync.');
    }
    await ctx.syncCoordinator.syncAccount(accountId);
    return {
      success: true,
      latestRun: ctx.syncStateRepo.getLatestSyncRun(accountId)
    };
  });

  wrapHandler(IPC_CHANNELS.SYNC_SCAN_ALL, async () => {
    await ctx.syncCoordinator.syncAllAccounts();
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.SYNC_CANCEL, (accountId?: string) => {
    if (accountId && typeof accountId !== 'string') {
      throw new ValidationError('Invalid account ID provided for cancellation.');
    }
    ctx.syncCoordinator.cancelSync(accountId);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.SYNC_GET_STATUS, (accountId: string) => {
    if (!accountId || typeof accountId !== 'string') {
      throw new ValidationError('Valid account ID is required.');
    }
    return {
      syncState: ctx.syncStateRepo.getSyncState(accountId),
      activeProgress: ctx.syncCoordinator.getSyncStatus(accountId),
      latestRun: ctx.syncStateRepo.getLatestSyncRun(accountId)
    };
  });

  wrapHandler(IPC_CHANNELS.SYNC_GET_SUMMARY, () => {
    const accounts = ctx.accountsRepo.getAll();
    let totalFiles = 0;
    const accountSummaries = accounts.map((acc) => {
      const counts = ctx.cloudFilesRepo.countByAccountId(acc.id);
      const syncState = ctx.syncStateRepo.getSyncState(acc.id);
      totalFiles += counts.files;
      return {
        accountId: acc.id,
        fileCount: counts.files,
        folderCount: counts.folders,
        totalCount: counts.total,
        lastSyncAt: syncState?.lastIncrementalSyncAt || syncState?.lastFullScanAt || null,
        status: acc.status
      };
    });
    const allGames = ctx.gamesRepo.getAll();
    return {
      totalFiles,
      totalGames: allGames.length,
      accounts: accountSummaries
    };
  });

  // --- Downloads Handlers ---
  wrapHandler(IPC_CHANNELS.DOWNLOADS_GET_ALL, () => {
    return ctx.downloadManager.getAllDownloads();
  });

  wrapHandler(IPC_CHANNELS.DOWNLOADS_QUEUE, async (gameId: string) => {
    const accounts = ctx.accountsRepo.getAll();
    const defaultAccountId = accounts[0]?.id || 'gdrive-primary';
    return await ctx.downloadManager.queueDownload({
      gameId,
      storageAccountId: defaultAccountId
    });
  });

  wrapHandler(IPC_CHANNELS.DOWNLOADS_CANCEL, async (downloadId: string) => {
    await ctx.downloadManager.cancelDownload(downloadId);
    return { success: true };
  });

<<<<<<< Updated upstream
=======
  wrapHandler(IPC_CHANNELS.DOWNLOADS_PRIORITIZE, (downloadId: string) => {
    if (!downloadId || typeof downloadId !== 'string') {
      throw new ValidationError('Valid download ID is required to prioritize download.');
    }
    ctx.downloadManager.prioritizeDownload(downloadId);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.DOWNLOADS_SET_MAX_CONCURRENT, (slots: number) => {
    if (typeof slots !== 'number' || slots < 1 || slots > 4) {
      throw new ValidationError('Max concurrent slots must be a number between 1 and 4.');
    }
    ctx.downloadManager.setMaxConcurrent(slots);
    return { success: true, maxConcurrent: slots };
  });

  wrapHandler(IPC_CHANNELS.DOWNLOADS_GET_MAX_CONCURRENT, () => {
    return ctx.downloadManager.getMaxConcurrent();
  });

  wrapHandler(IPC_CHANNELS.DOWNLOADS_CLEAR_COMPLETED, () => {
    const cleared = ctx.downloadManager.clearCompleted();
    return { success: true, cleared };
  });

  // --- Preparation Handlers & Event Forwarding ---
  if (ctx.preparationService) {
    ctx.preparationService.onProgress((progress) => {
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.webContents.send(IPC_CHANNELS.PREPARATION_PROGRESS_EVENT, progress);
      }
    });
  }

  wrapHandler(IPC_CHANNELS.PREPARATION_PREPARE_GAME, async (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required for preparation.');
    }
    if (!ctx.preparationService) {
      throw new Error('GamePreparationService is not configured.');
    }
    return await ctx.preparationService.prepare(gameId);
  });

  wrapHandler(IPC_CHANNELS.PREPARATION_GET_STATUS, (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required.');
    }
    return ctx.preparationJobsRepo?.getByGameId(gameId) || null;
  });

  wrapHandler(IPC_CHANNELS.PREPARATION_CANCEL, (jobId: string) => {
    if (!jobId || typeof jobId !== 'string') {
      throw new ValidationError('Valid job ID is required.');
    }
    ctx.preparationService?.cancel(jobId);
    return { success: true };
  });

  // --- Smart Cache & Storage V2 Handlers ---
  wrapHandler(IPC_CHANNELS.STORAGE_GET_CACHE_BREAKDOWN, () => {
    return ctx.cacheManager.getCacheBreakdown();
  });

  wrapHandler(IPC_CHANNELS.STORAGE_REMOVE_LOCAL_COPY, (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required.');
    }
    return ctx.cacheManager.removeLocalCopy(gameId, {
      gamesRepo: ctx.gamesRepo,
      gameFilesRepo: ctx.gameFilesRepo
    });
  });

  wrapHandler(IPC_CHANNELS.STORAGE_SET_PINNED, (gameId: string, pinned: boolean) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required.');
    }
    ctx.gamesRepo.setPinned(gameId, Boolean(pinned));
    return { success: true, pinned: Boolean(pinned) };
  });

  wrapHandler(IPC_CHANNELS.STORAGE_GET_EVICTION_CANDIDATES, (requiredBytes?: number) => {
    return ctx.cacheManager.getEvictionCandidates(requiredBytes || 0, ctx.gamesRepo);
  });

  wrapHandler(IPC_CHANNELS.STORAGE_VERIFY_LOCAL_GAME, async (gameId: string, deepVerify?: boolean) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required.');
    }
    const manifestService = new LocalManifestService(ctx.gameManifestsRepo);
    const gameDir = ctx.cacheManager.getGameCacheDir(gameId);
    return await manifestService.verifyLocalGame(gameId, gameDir, Boolean(deepVerify));
  });

  wrapHandler(IPC_CHANNELS.STORAGE_SET_CACHE_LIMIT, (limitBytes: number) => {
    if (typeof limitBytes !== 'number' || limitBytes <= 0) {
      throw new ValidationError('Cache limit must be a positive number in bytes.');
    }
    ctx.cacheManager.setCacheLimit(limitBytes);
    return { success: true, limitBytes };
  });

  wrapHandler(IPC_CHANNELS.STORAGE_SET_CACHE_DIR, (newDir: string) => {
    if (!newDir || typeof newDir !== 'string') {
      throw new ValidationError('Valid directory path is required.');
    }
    ctx.cacheManager.setCustomCacheDir(newDir);
    return { success: true, cacheDir: ctx.cacheManager.getCachePath() };
  });

  // --- Launcher & Emulator Handlers (Phase 4A) ---
  if (ctx.launcherManager) {
    ctx.launcherManager.onRunningStateChange((event) => {
      if (!ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.webContents.send(IPC_CHANNELS.LAUNCHER_GAME_STATE_CHANGED_EVENT, event);
      }
    });
  }

  wrapHandler(IPC_CHANNELS.LAUNCHER_LAUNCH_GAME, async (gameId: string) => {
    if (!ctx.launcherManager) {
      throw new Error('LauncherManager is not configured.');
    }
    return ctx.launcherManager.launchGame(gameId);
  });

  wrapHandler(IPC_CHANNELS.LAUNCHER_STOP_GAME, async (gameId: string) => {
    if (!ctx.launcherManager) {
      throw new Error('LauncherManager is not configured.');
    }
    const stopped = await ctx.launcherManager.stopGame(gameId);
    return { success: stopped };
  });

  wrapHandler(IPC_CHANNELS.LAUNCHER_GET_RUNNING_GAMES, () => {
    if (!ctx.launcherManager) return [];
    return ctx.launcherManager.getRunningGames();
  });

  wrapHandler(IPC_CHANNELS.LAUNCHER_GET_PROFILE, async (gameId: string) => {
    if (!ctx.launcherManager) {
      throw new Error('LauncherManager is not configured.');
    }
    return ctx.launcherManager.getEffectiveProfile(gameId);
  });

  wrapHandler(IPC_CHANNELS.LAUNCHER_SAVE_PROFILE, async (profile: Partial<LaunchProfile> & { gameId: string }) => {
    if (!ctx.launcherManager) {
      throw new Error('LauncherManager is not configured.');
    }
    return ctx.launcherManager.saveProfile(profile);
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_GET_ALL, () => {
    if (!ctx.emulatorsRepo) return [];
    return ctx.emulatorsRepo.getAll();
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_GET_BY_PLATFORM, (platform: GamePlatform) => {
    if (!ctx.emulatorsRepo) return [];
    return ctx.emulatorsRepo.getByPlatform(platform);
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_UPSERT, (emulator: Emulator) => {
    if (!ctx.emulatorsRepo) {
      throw new Error('EmulatorsRepository is not configured.');
    }
    ctx.emulatorsRepo.upsert(emulator);
    return { success: true, emulator };
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_DELETE, (id: string) => {
    if (!ctx.emulatorsRepo) {
      throw new Error('EmulatorsRepository is not configured.');
    }
    const deleted = ctx.emulatorsRepo.delete(id);
    return { success: deleted };
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_AUTO_DETECT, async (customPaths?: string[]) => {
    if (!ctx.launcherManager) return [];
    return ctx.launcherManager.autoDetectEmulators(customPaths);
  });

  wrapHandler(IPC_CHANNELS.EMULATORS_BROWSE_EXECUTABLE, async (title?: string) => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: title || 'Select Emulator Executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: process.platform === 'win32' ? ['exe', 'bat', 'cmd'] : ['*'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, filePath: result.filePaths[0] };
  });

  wrapHandler(IPC_CHANNELS.SESSIONS_GET_BY_GAME, (gameId: string) => {
    if (!ctx.gameSessionsRepo) return [];
    return ctx.gameSessionsRepo.getByGameId(gameId);
  });

  wrapHandler(IPC_CHANNELS.SESSIONS_GET_ALL, () => {
    if (!ctx.gameSessionsRepo) return [];
    return ctx.gameSessionsRepo.getAll();
  });

  // --- Instant Play & Progressive Streaming (Phase 4C) ---
  wrapHandler(IPC_CHANNELS.STREAMING_GET_STRATEGY, async (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required to get playback strategy.');
    }
    if (ctx.launcherManager) {
      return await ctx.launcherManager.getPlaybackStrategy(gameId);
    }
    return {
      strategy: 'LOCAL_REQUIRED',
      reason: 'Launcher manager not available.',
      isStreamable: false,
      estimatedHydrationTimeMs: 0
    };
  });

  wrapHandler(IPC_CHANNELS.STREAMING_HYDRATE_AND_LAUNCH, async (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required to hydrate and launch.');
    }
    if (!ctx.launcherManager) {
      throw new ValidationError('Launcher manager not available.');
    }
    return await ctx.launcherManager.hydrateAndLaunch(gameId);
  });

  wrapHandler(IPC_CHANNELS.STREAMING_GET_METRICS, () => {
    return {
      averageRangeLatencyMs: 0,
      rangeThroughputBps: 0,
      cacheHitRate: 1.0,
      prefetchHitRate: 1.0,
      stallsCount: 0,
      bytesFetched: 0,
      bytesPrefetched: 0,
      wastedPrefetchBytes: 0
    };
  });

  wrapHandler(IPC_CHANNELS.STREAMING_CLEAR_CACHE, () => {
    return { success: true };
  });

  // --- Metadata & Artwork Scraping Handlers (Phase 5A) ---
  wrapHandler(IPC_CHANNELS.METADATA_SCRAPE_GAME, async (gameId: string) => {
    if (!gameId || typeof gameId !== 'string') {
      throw new ValidationError('Valid game ID is required for metadata scraping.');
    }
    if (ctx.jobManager) {
      const job = ctx.jobManager.enqueueGame(gameId, 'USER_REQUESTED');
      await ctx.jobManager.executeJob(job);
      return ctx.gamesRepo.getById(gameId);
    }
    if (!ctx.metadataService) {
      throw new Error('MetadataService is not configured.');
    }
    return await ctx.metadataService.scrapeGame(gameId, { force: true });
  });

  wrapHandler(IPC_CHANNELS.METADATA_SCRAPE_ALL, async (options?: { overwrite?: boolean }) => {
    if (ctx.jobManager) {
      const enqueued = ctx.jobManager.enqueueAllGames('BACKGROUND', !options?.overwrite);
      ctx.jobManager.processQueue().catch((err) => log.error('Background batch job error:', err));
      return { total: enqueued, scraped: enqueued, failed: 0 };
    }
    if (!ctx.metadataService) {
      throw new Error('MetadataService is not configured.');
    }
    return await ctx.metadataService.scrapeAll({
      overwrite: options?.overwrite,
      onProgress: (progress) => {
        if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
          ctx.mainWindow.webContents.send(IPC_CHANNELS.METADATA_PROGRESS_EVENT, progress);
        }
      }
    });
  });

  wrapHandler(IPC_CHANNELS.METADATA_SEARCH, async (data: { query: string; platform?: string; gameId?: string }) => {
    if (!ctx.providerRegistry) {
      throw new Error('MetadataProviderRegistry is not configured.');
    }
    const identity = {
      gameId: data.gameId || '',
      title: data.query,
      cleanTitle: data.query,
      platform: data.platform || '',
      normalizedPlatform: data.platform || ''
    };
    return await ctx.providerRegistry.searchCandidates(identity);
  });

  wrapHandler(IPC_CHANNELS.METADATA_APPLY_CANDIDATE, async (data: { gameId: string; candidate: any; isUserConfirmed?: boolean }) => {
    if (!ctx.mergeService) {
      throw new Error('MetadataMergeService is not configured.');
    }
    const result = ctx.mergeService.applyCandidate(data.gameId, data.candidate, {
      isUserConfirmed: data.isUserConfirmed ?? true
    });

    // Download artwork asynchronously if available
    if (ctx.artworkCacheManager) {
      const { coverUrl, logoUrl, backgroundUrl } = data.candidate;
      if (coverUrl) {
        ctx.artworkCacheManager.downloadAndCache({
          gameId: data.gameId,
          remoteUrl: coverUrl,
          assetType: 'cover',
          provider: data.candidate.provider
        }).catch(() => {});
      }
      if (logoUrl) {
        ctx.artworkCacheManager.downloadAndCache({
          gameId: data.gameId,
          remoteUrl: logoUrl,
          assetType: 'logo',
          provider: data.candidate.provider
        }).catch(() => {});
      }
      if (backgroundUrl) {
        ctx.artworkCacheManager.downloadAndCache({
          gameId: data.gameId,
          remoteUrl: backgroundUrl,
          assetType: 'banner',
          provider: data.candidate.provider
        }).catch(() => {});
      }
    }

    return result;
  });

  wrapHandler(IPC_CHANNELS.METADATA_GET_DETAILS, async (gameId: string) => {
    const metadata = ctx.metadataRepo?.getByGameId(gameId) || null;
    const sources = ctx.metadataSourcesRepo?.getByGameId(gameId) || [];
    const artwork = ctx.metadataArtworkRepo?.getByGameId(gameId) || [];
    const cachedFiles = ctx.artworkCacheManager?.getCachedArtwork(gameId) || { screenshotPaths: [] };

    return {
      metadata,
      sources,
      artwork,
      cachedFiles
    };
  });

  wrapHandler(IPC_CHANNELS.METADATA_SET_USER_OVERRIDE, async (data: { gameId: string; field: string; value: any }) => {
    if (!ctx.mergeService) {
      throw new Error('MetadataMergeService is not configured.');
    }
    ctx.mergeService.setUserOverride(data.gameId, data.field, data.value);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.METADATA_REMOVE_USER_OVERRIDE, async (data: { gameId: string; field: string }) => {
    if (!ctx.mergeService) {
      throw new Error('MetadataMergeService is not configured.');
    }
    ctx.mergeService.removeUserOverride(data.gameId, data.field);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.METADATA_GET_REVIEW_QUEUE, async (limit?: number) => {
    if (!ctx.metadataSourcesRepo) {
      return [];
    }
    return ctx.metadataSourcesRepo.getReviewQueue(limit || 50);
  });

  wrapHandler(IPC_CHANNELS.METADATA_RESOLVE_REVIEW, async (data: { sourceId: string; status: 'USER_CONFIRMED' | 'REJECTED'; candidate?: any }) => {
    if (!ctx.metadataSourcesRepo) {
      throw new Error('MetadataSourcesRepository is not configured.');
    }
    const source = ctx.metadataSourcesRepo.getById(data.sourceId);
    if (!source) {
      throw new Error(`Metadata source ${data.sourceId} not found.`);
    }

    if (data.status === 'USER_CONFIRMED' && data.candidate && ctx.mergeService) {
      return ctx.mergeService.applyCandidate(source.gameId, data.candidate, {
        isUserConfirmed: true
      });
    }

    ctx.metadataSourcesRepo.updateStatusById(data.sourceId, data.status);
    return { success: true };
  });

  wrapHandler(IPC_CHANNELS.METADATA_SAVE_CUSTOM_ARTWORK, async (data: { gameId: string; type: GameArtworkType; filePath: string }) => {
    if (!ctx.artworkCacheManager) {
      throw new Error('ArtworkCacheManager is not configured.');
    }
    const savedPath = await ctx.artworkCacheManager.saveCustomArtwork(data.gameId, data.type, data.filePath);
    return { success: true, path: savedPath };
  });

  wrapHandler(IPC_CHANNELS.METADATA_BROWSE_ARTWORK_FILE, async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: 'Select Custom Artwork Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images (*.png, *.jpg, *.webp)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  wrapHandler(IPC_CHANNELS.METADATA_ENQUEUE_JOB, async (data: { gameId: string; priority?: any }) => {
    if (!ctx.jobManager) {
      throw new Error('MetadataJobManager is not configured.');
    }
    const job = ctx.jobManager.enqueueGame(data.gameId, data.priority || 'USER_REQUESTED');
    return job;
  });

  wrapHandler(IPC_CHANNELS.METADATA_GET_JOB_STATUS, async (gameId: string) => {
    if (!ctx.metadataJobsRepo) return null;
    return ctx.metadataJobsRepo.getByGameId(gameId);
  });

  wrapHandler(IPC_CHANNELS.METADATA_GET_CACHE_STATS, async () => {
    if (!ctx.artworkCacheManager) {
      return { totalFiles: 0, totalSizeBytes: 0, coversCount: 0, bannersCount: 0, logosCount: 0, screenshotsCount: 0 };
    }
    return await ctx.artworkCacheManager.getCacheStats();
  });

  wrapHandler(IPC_CHANNELS.METADATA_CLEAR_CACHE, async (gameId?: string) => {
    if (!ctx.artworkCacheManager) {
      return { success: true };
    }
    await ctx.artworkCacheManager.clearCache(gameId);
    return { success: true };
  });

>>>>>>> Stashed changes
  // --- Settings Handlers ---
  wrapHandler(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return ctx.settingsRepo.getAll();
  });

  wrapHandler(IPC_CHANNELS.SETTINGS_SET, (key: string, value: unknown) => {
    ctx.settingsRepo.set(key, value);
    return { success: true };
  });

  // --- System & Window Handlers ---
  wrapHandler(IPC_CHANNELS.SYSTEM_GET_INFO, () => {
    return {
      appName: 'Game Vault',
      version: '0.1.0',
      phase: 'Foundation',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron
    };
  });

  wrapHandler(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    ctx.mainWindow.minimize();
  });

  wrapHandler(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (ctx.mainWindow.isMaximized()) {
      ctx.mainWindow.unmaximize();
    } else {
      ctx.mainWindow.maximize();
    }
  });

  wrapHandler(IPC_CHANNELS.WINDOW_CLOSE, () => {
    ctx.mainWindow.close();
  });

  log.info('All IPC handlers registered successfully.');
}
