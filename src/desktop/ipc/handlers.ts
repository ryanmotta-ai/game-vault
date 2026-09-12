import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { GamesRepository } from '../../database/repositories/gamesRepository';
import { StorageAccountsRepository } from '../../database/repositories/storageAccountsRepository';
import { DownloadsRepository } from '../../database/repositories/downloadsRepository';
import { SettingsRepository } from '../../database/repositories/settingsRepository';
import { StorageManager } from '../../storage/StorageManager';
import { CacheManager } from '../../storage/CacheManager';
import { DownloadManager } from '../../downloads/DownloadManager';
import { GameState, StorageProviderType } from '../../core/types';
import { logger } from '../../core/logger';
import { AppError, ValidationError } from '../../core/errors/AppError';

export interface IpcContext {
  gamesRepo: GamesRepository;
  accountsRepo: StorageAccountsRepository;
  downloadsRepo: DownloadsRepository;
  settingsRepo: SettingsRepository;
  storageManager: StorageManager;
  cacheManager: CacheManager;
  downloadManager: DownloadManager;
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
