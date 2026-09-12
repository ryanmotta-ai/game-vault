export type GameState = 'CLOUD' | 'DOWNLOADING' | 'READY';

export type GamePlatform =
  | 'PC'
  | 'PlayStation'
  | 'PlayStation 2'
  | 'PlayStation 3'
  | 'PSP'
  | 'Nintendo Switch'
  | 'Nintendo 64'
  | 'Game Boy Advance'
  | 'SNES'
  | 'NES'
  | 'Retro';

export interface Game {
  id: string;
  title: string;
  slug: string;
  description?: string;
  coverUrl?: string;
  bannerUrl?: string;
  platform: GamePlatform;
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  state: GameState;
  sizeBytes: number;
  installedPath?: string;
  playTimeSeconds: number;
  lastPlayedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type StorageAccountStatus = 'ACTIVE' | 'DISCONNECTED' | 'ERROR' | 'REVOKED';

export type StorageProviderType = 'google_drive' | 'onedrive' | 'dropbox' | 'nas' | 'local';

export interface StorageAccount {
  id: string;
  providerType: StorageProviderType;
  accountName: string;
  accountEmail?: string;
  status: StorageAccountStatus;
  quotaTotalBytes: number;
  quotaUsedBytes: number;
  authConfigSecureRef?: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type GameFileStatus = 'REMOTE' | 'DOWNLOADING' | 'CACHED_LOCAL';

export interface GameFile {
  id: string;
  gameId: string;
  storageAccountId: string;
  remoteFileId: string;
  remotePath: string;
  filename: string;
  sizeBytes: number;
  md5Checksum?: string;
  status: GameFileStatus;
  localPath?: string;
  createdAt: string;
  updatedAt: string;
}

export type DownloadStatus = 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface DownloadItem {
  id: string;
  gameId: string;
  gameFileId?: string;
  storageAccountId: string;
  status: DownloadStatus;
  totalBytes: number;
  downloadedBytes: number;
  downloadSpeedBps: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Emulator {
  id: string;
  name: string;
  platform: GamePlatform;
  executablePath: string;
  defaultArgs?: string;
  configPath?: string;
  isInstalled: boolean;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface StorageQuotaSummary {
  cloudTotalBytes: number;
  cloudUsedBytes: number;
  localCachePath: string;
  localCacheUsedBytes: number;
  localCacheAvailableBytes: number;
  connectedAccountsCount: number;
}
