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
