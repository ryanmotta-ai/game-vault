import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import { Game, GameState, StorageAccount, StorageProviderType, StorageQuotaSummary, DownloadItem, SyncRun, SyncProgress, StorageSyncState } from '../core/types';
import { RemoteFile } from '../providers/types';

const api = {
  // Games
  getAllGames: (): Promise<Game[]> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_ALL),
  getGameById: (id: string): Promise<Game | null> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_BY_ID, id),
  getGamesByState: (state: GameState): Promise<Game[]> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_BY_STATE, state),
  updateGameState: (id: string, state: GameState, installedPath?: string): Promise<Game> =>
    ipcRenderer.invoke(IPC_CHANNELS.GAMES_UPDATE_STATE, id, state, installedPath),

  // Storage & Multi-Account
  getStorageAccounts: (): Promise<StorageAccount[]> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_ACCOUNTS),
  connectStorageAccount: (data: { type: StorageProviderType; name?: string }): Promise<StorageAccount> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CONNECT_ACCOUNT, data),
  disconnectStorageAccount: (accountId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DISCONNECT_ACCOUNT, accountId),
  reconnectStorageAccount: (accountId: string): Promise<StorageAccount> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_RECONNECT_ACCOUNT, accountId),
  getQuotaSummary: (): Promise<StorageQuotaSummary> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_QUOTA_SUMMARY),
  clearCache: (): Promise<StorageQuotaSummary> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CLEAR_CACHE),
  listStorageFiles: (accountId: string, folderId?: string): Promise<RemoteFile[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST_FILES, accountId, folderId),

  // Cloud Inventory & Sync
  scanAccount: (accountId: string): Promise<{ success: boolean; latestRun: SyncRun | null }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_SCAN_ACCOUNT, accountId),
  scanAllAccounts: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_SCAN_ALL),
  cancelScan: (accountId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_CANCEL, accountId),
  getSyncStatus: (accountId: string): Promise<{
    syncState: StorageSyncState | null;
    activeProgress: SyncProgress | null;
    latestRun: SyncRun | null;
  }> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS, accountId),
  getSyncSummary: (): Promise<{
    totalFiles: number;
    totalGames: number;
    accounts: Array<{
      accountId: string;
      fileCount: number;
      folderCount: number;
      totalCount: number;
      lastSyncAt: string | null;
      status: string;
    }>;
  }> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_SUMMARY),
  onSyncProgress: (callback: (progress: SyncProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SyncProgress) => {
      callback(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.SYNC_PROGRESS_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYNC_PROGRESS_EVENT, handler);
    };
  },

  // Downloads
  getAllDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_GET_ALL),
  queueDownload: (gameId: string): Promise<DownloadItem> => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_QUEUE, gameId),
  cancelDownload: (downloadId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, downloadId),

  // Settings
  getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  setSetting: (key: string, value: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),

<<<<<<< Updated upstream
=======
  // Connected Services & Integrations Hub
  getIntegrations: (): Promise<SanitizedIntegrationView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_LIST),
  getIntegrationDetails: (id: string): Promise<SanitizedIntegrationView | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_GET, id),
  getIntegrationConnections: (integrationId?: string): Promise<IntegrationConnection[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_GET_CONNECTIONS, integrationId),
  connectIntegration: (integrationId: string, options?: ConnectOptions): Promise<IntegrationConnection> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_CONNECT, { integrationId, options }),
  disconnectIntegration: (connectionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_DISCONNECT, connectionId),
  removeIntegrationConnection: (connectionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_REMOVE_CONNECTION, connectionId),
  testIntegrationConnection: (connectionId: string): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_TEST, connectionId),
  getIntegrationHealth: (connectionId: string): Promise<IntegrationHealth> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_GET_HEALTH, connectionId),

  // Metadata & Artwork Scraping (Phase 5A)
  scrapeGameMetadata: (gameId: string): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_SCRAPE_GAME, gameId),
  scrapeAllMetadata: (options?: { overwrite?: boolean }): Promise<{ total: number; scraped: number; failed: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_SCRAPE_ALL, options),
  searchMetadata: (query: string, platform?: string, gameId?: string): Promise<any[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_SEARCH, { query, platform, gameId }),
  applyMetadataCandidate: (gameId: string, candidate: any, isUserConfirmed?: boolean): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_APPLY_CANDIDATE, { gameId, candidate, isUserConfirmed }),
  getGameMetadataDetails: (gameId: string): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_GET_DETAILS, gameId),
  setMetadataUserOverride: (gameId: string, field: string, value: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_SET_USER_OVERRIDE, { gameId, field, value }),
  removeMetadataUserOverride: (gameId: string, field: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_REMOVE_USER_OVERRIDE, { gameId, field }),
  getMetadataReviewQueue: (limit?: number): Promise<any[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_GET_REVIEW_QUEUE, limit),
  resolveMetadataReview: (sourceId: string, status: 'USER_CONFIRMED' | 'REJECTED', candidate?: any): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_RESOLVE_REVIEW, { sourceId, status, candidate }),
  saveCustomArtwork: (gameId: string, type: string, filePath: string): Promise<{ success: boolean; path: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_SAVE_CUSTOM_ARTWORK, { gameId, type, filePath }),
  browseArtworkFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_BROWSE_ARTWORK_FILE),
  enqueueMetadataJob: (gameId: string, priority?: string): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_ENQUEUE_JOB, { gameId, priority }),
  getMetadataJobStatus: (gameId: string): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_GET_JOB_STATUS, gameId),
  getArtworkCacheStats: (): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_GET_CACHE_STATS),
  clearArtworkCache: (gameId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.METADATA_CLEAR_CACHE, gameId),
  onMetadataProgress: (callback: (event: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, eventData: any) => {
      callback(eventData);
    };
    ipcRenderer.on(IPC_CHANNELS.METADATA_PROGRESS_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.METADATA_PROGRESS_EVENT, handler);
    };
  },

>>>>>>> Stashed changes
  // System & Window controls
  getSystemInfo: (): Promise<{
    appName: string;
    version: string;
    phase: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    electronVersion: string;
  }> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_INFO),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE)
};

contextBridge.exposeInMainWorld('gameVault', api);

export type GameVaultAPI = typeof api;
