export type GameState = 'CLOUD' | 'DOWNLOADING' | 'READY';

export type GamePlatform =
  | 'PC'
  | 'PlayStation'
  | 'PlayStation 2'
  | 'PlayStation 3'
  | 'PSP'
  | 'GameCube'
  | 'Wii'
  | 'Dreamcast'
  | 'Nintendo Switch'
  | 'Nintendo 64'
  | 'Nintendo DS'
  | 'Nintendo 3DS'
  | 'Game Boy'
  | 'Game Boy Color'
  | 'Game Boy Advance'
  | 'NES'
  | 'SNES'
  | 'Xbox'
  | 'Xbox 360'
  | 'Retro'
  | 'Unknown';

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
  providerAccountId: string;
  accountName: string;
  accountEmail?: string;
  credentialKey: string;
  status: StorageAccountStatus;
  quotaTotalBytes: number;
  quotaUsedBytes: number;
  createdAt: string;
  updatedAt: string;
  lastAuthenticatedAt?: string;
}

export type GameFileStatus = 'REMOTE' | 'DOWNLOADING' | 'CACHED_LOCAL' | 'MISSING';

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

export type CloudFileClassification = 'GAME' | 'ARCHIVE' | 'DOCUMENT' | 'MEDIA' | 'UNKNOWN';
export type CandidateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CloudFile {
  id: string;
  storageAccountId: string;
  remoteFileId: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum?: string;
  parentRemoteId?: string;
  remotePath: string;
  modifiedTime?: string;
  isFolder: boolean;
  isShortcut: boolean;
  trashed: boolean;
  classification: CloudFileClassification;
  detectedPlatform?: GamePlatform;
  classificationConfidence: number; // 0 to 1
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageSyncState {
  storageAccountId: string;
  initialScanCompleted: boolean;
  startPageToken?: string;
  nextChangePageToken?: string;
  lastFullScanAt?: string;
  lastIncrementalSyncAt?: string;
  lastError?: string;
  updatedAt: string;
}

export type SyncRunStatus = 'STARTED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface SyncRun {
  id: string;
  storageAccountId: string;
  startedAt: string;
  finishedAt?: string;
  status: SyncRunStatus;
  foldersScanned: number;
  filesScanned: number;
  gamesDetected: number;
  errorMessage?: string;
}

export interface SyncProgress {
  accountId: string;
  accountName?: string;
  status: SyncRunStatus;
  phase: 'DISCOVERY' | 'CLASSIFICATION' | 'INGESTION' | 'CHANGES' | 'IDLE';
  foldersScanned: number;
  filesScanned: number;
  gamesDetected: number;
  currentPath?: string;
  percentage?: number;
  error?: string;
}

export interface GameCandidate {
  primaryFile: CloudFile;
  additionalFiles: CloudFile[];
  candidateTitle: string;
  normalizedTitle: string;
  platform: GamePlatform;
  confidence: CandidateConfidence;
  confidenceScore: number;
  edition?: string;
  discIndex?: number;
}
