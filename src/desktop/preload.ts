import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import { Game, GameState, StorageAccount, StorageProviderType, StorageQuotaSummary, DownloadItem } from '../core/types';

const api = {
  // Games
  getAllGames: (): Promise<Game[]> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_ALL),
  getGameById: (id: string): Promise<Game | null> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_BY_ID, id),
  getGamesByState: (state: GameState): Promise<Game[]> => ipcRenderer.invoke(IPC_CHANNELS.GAMES_GET_BY_STATE, state),
  updateGameState: (id: string, state: GameState, installedPath?: string): Promise<Game> =>
    ipcRenderer.invoke(IPC_CHANNELS.GAMES_UPDATE_STATE, id, state, installedPath),

  // Storage
  getStorageAccounts: (): Promise<StorageAccount[]> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_ACCOUNTS),
  addStorageAccount: (data: { name: string; type: StorageProviderType; email?: string }): Promise<StorageAccount> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_ADD_ACCOUNT, data),
  getQuotaSummary: (): Promise<StorageQuotaSummary> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_QUOTA_SUMMARY),
  clearCache: (): Promise<StorageQuotaSummary> => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CLEAR_CACHE),

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
