import { app, BrowserWindow, protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { setupGlobalErrorHandlers } from '../core/errors/globalHandler';
import { logger } from '../core/logger';
import { getDb } from '../database/connection';
import { initializeDatabaseSchema } from '../database/schema';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { StorageAccountsRepository } from '../database/repositories/storageAccountsRepository';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { SettingsRepository } from '../database/repositories/settingsRepository';
import { CloudFilesRepository } from '../database/repositories/cloudFilesRepository';
import { SyncStateRepository } from '../database/repositories/syncStateRepository';
import { CatalogIngestionService } from '../catalog/CatalogIngestionService';
import { CloudInventoryScanner } from '../sync/CloudInventoryScanner';
import { SyncCoordinator } from '../sync/SyncCoordinator';
import { storageManager } from '../storage/StorageManager';
import { cacheManager } from '../storage/CacheManager';
import { DownloadManager } from '../downloads/DownloadManager';
import { registerIpcHandlers } from './ipc/handlers';
import { applySecurityPolicies } from './security';
import { seedInitialDataIfEmpty } from './seedData';
<<<<<<< Updated upstream
=======
import { IntegrationConnectionsRepository } from '../database/repositories/integrationConnectionsRepository';
import {
  IntegrationManager,
  integrationRegistry,
  GoogleDriveIntegrationAdapter,
  ScreenScraperIntegrationAdapter,
  RetroAchievementsIntegrationAdapter,
  IgdbIntegrationAdapter,
  EmulationStationIntegrationAdapter
} from '../integrations';
import {
  ArtworkCacheManager,
  MetadataService,
  SteamStorefrontScraper,
  IgdbMetadataProvider,
  MetadataProviderRegistry,
  MetadataMergeService,
  MetadataJobManager
} from '../metadata';
import { GameMetadataRepository } from '../database/repositories/gameMetadataRepository';
import { GameMetadataSourcesRepository } from '../database/repositories/gameMetadataSourcesRepository';
import { GameArtworkRepository } from '../database/repositories/gameArtworkRepository';
import { MetadataJobsRepository } from '../database/repositories/metadataJobsRepository';
import { ScreenScraperMetadataProvider } from '../integrations/metadata/ScreenScraperMetadataProvider';
>>>>>>> Stashed changes

setupGlobalErrorHandlers();

// Register local-artwork custom scheme for instant zero-latency offline artwork rendering
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-artwork',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
]);

const log = logger.child('Main');
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<BrowserWindow> {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const preloadPath = path.join(__dirname, 'preload.js');

  log.info('Creating main application window...', { isDev, preloadPath });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0a0d14',
    title: 'Game Vault',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  applySecurityPolicies(win);

  win.once('ready-to-show', () => {
    win.show();
    log.info('Main window is now visible.');

    if (process.env.ELECTRON_SMOKE_TEST?.trim() === '1' || process.argv.includes('--smoke-test')) {
      log.info('SMOKE_TEST_SUCCESS: Main window and renderer loaded successfully. Quitting app.');
      setTimeout(() => {
        app.quit();
      }, 500);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (isDev && devServerUrl) {
    log.info(`Loading Vite dev server at ${devServerUrl}`);
    await win.loadURL(devServerUrl);
  } else {
    const indexPath = path.join(__dirname, '../ui/index.html');
    log.info(`Loading production file at ${indexPath}`);
    await win.loadFile(indexPath);
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

async function initializeApp(): Promise<void> {
  log.info('Starting Game Vault Phase 2B runtime...');

  // Initialize SQLite Database
  const db = getDb();
  initializeDatabaseSchema(db);

  // Initialize Repositories
  const gamesRepo = new GamesRepository(db);
  const gameFilesRepo = new GameFilesRepository(db);
  const accountsRepo = new StorageAccountsRepository(db);
  const downloadsRepo = new DownloadsRepository(db);
  const settingsRepo = new SettingsRepository(db);
  const cloudFilesRepo = new CloudFilesRepository(db);
  const syncStateRepo = new SyncStateRepository(db);
<<<<<<< Updated upstream
=======
  const preparationJobsRepo = new PreparationJobsRepository(db);
  const gameManifestsRepo = new GameManifestsRepository(db);
  const metadataRepo = new GameMetadataRepository(db);
  const metadataSourcesRepo = new GameMetadataSourcesRepository(db);
  const metadataArtworkRepo = new GameArtworkRepository(db);
  const metadataJobsRepo = new MetadataJobsRepository(db);

  // Configure CacheManager with settings repo
  cacheManager.setSettingsRepository(settingsRepo);
>>>>>>> Stashed changes

  // Seed Mock Data for Foundation phase
  seedInitialDataIfEmpty(gamesRepo, accountsRepo);

  // Register existing accounts in StorageManager
  storageManager.setRepository(accountsRepo);
  storageManager.initializeAccounts(accountsRepo.getAll());

  // Initialize Sync & Catalog Services
  const catalogIngestion = new CatalogIngestionService(gamesRepo, gameFilesRepo);
  const scanner = new CloudInventoryScanner(cloudFilesRepo);
  const syncCoordinator = new SyncCoordinator(
    storageManager,
    scanner,
    cloudFilesRepo,
    syncStateRepo,
    catalogIngestion
  );

  // Initialize Services
  const downloadManager = new DownloadManager(downloadsRepo, gamesRepo);

  // Register local-artwork custom protocol handler
  protocol.handle('local-artwork', (request) => {
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.hostname + url.pathname);
      if (/^[a-zA-Z]:/.test(filePath) || /^[a-zA-Z]\//.test(filePath)) {
        if (/^[a-zA-Z]\//.test(filePath)) {
          filePath = filePath[0] + ':' + filePath.slice(1);
        }
      }
      if (fs.existsSync(filePath)) {
        return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`);
      }
    } catch (err) {
      log.warn('Failed to resolve local-artwork file:', err);
    }
    return new Response('Not Found', { status: 404 });
  });

  // Initialize Metadata & Artwork Subsystem (Phase 5A)
  const artworkCacheManager = new ArtworkCacheManager({
    artworkBaseDir: cacheManager.getArtworkDir(),
    artworkRepo: metadataArtworkRepo
  });
  const steamScraper = new SteamStorefrontScraper();
  const screenScraperProvider = new ScreenScraperMetadataProvider(integrationConnectionsRepo);
  const igdbProvider = new IgdbMetadataProvider(integrationConnectionsRepo);

  const providerRegistry = new MetadataProviderRegistry({
    integrationManager
  });
  providerRegistry.registerProvider(screenScraperProvider);
  providerRegistry.registerProvider(igdbProvider);
  providerRegistry.registerProvider(steamScraper);

  const mergeService = new MetadataMergeService(metadataRepo, metadataSourcesRepo, gamesRepo);

  const jobManager = new MetadataJobManager({
    jobsRepo: metadataJobsRepo,
    gamesRepo,
    gameFilesRepo,
    providerRegistry,
    mergeService,
    artworkCache: artworkCacheManager
  });
  jobManager.start();

  const metadataService = new MetadataService({
    gamesRepo,
    artworkCache: artworkCacheManager,
    providers: [screenScraperProvider, igdbProvider, steamScraper]
  });

  // Create Window & Register IPC Handlers
  mainWindow = await createWindow();

  registerIpcHandlers({
    gamesRepo,
    accountsRepo,
    downloadsRepo,
    settingsRepo,
    cloudFilesRepo,
    syncStateRepo,
    catalogIngestion,
    syncCoordinator,
    storageManager,
    cacheManager,
    downloadManager,
<<<<<<< Updated upstream
    mainWindow
  });

  log.info('Game Vault Phase 2B initialized successfully.');
=======
    integrationManager,
    metadataService,
    artworkCacheManager,
    metadataRepo,
    metadataSourcesRepo,
    metadataArtworkRepo,
    metadataJobsRepo,
    providerRegistry,
    mergeService,
    jobManager,
    mainWindow
  });

  log.info('Game Vault Phase 5A initialized successfully.');
>>>>>>> Stashed changes
}

app.whenReady().then(async () => {
  try {
    await initializeApp();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = await createWindow();
      }
    });
  } catch (err) {
    log.error('Fatal initialization error:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    log.info('All windows closed, quitting application.');
    app.quit();
  }
});
