export type GameState = 'CLOUD' | 'QUEUED' | 'DOWNLOADING' | 'PREPARING' | 'READY' | 'ERROR';

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
  lastAccessedAt?: string;
  pinned?: boolean;
  genres?: string[];
  rating?: number;
  screenshotUrls?: string[];
  localCoverPath?: string;
  localBannerPath?: string;
  localScreenshotPaths?: string[];
  metadataSource?: string;
  metadataScrapedAt?: string;
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
  destinationPath?: string;
  partialPath?: string;
  errorMessage?: string;
  priority?: number;
  retryCount?: number;
  lastErrorCode?: string;
  resumeSupported?: boolean;
  remoteModifiedTime?: string;
  remoteEtag?: string;
  remoteMd5?: string;
  errorReason?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface DownloadProgressEvent {
  downloadId: string;
  gameId: string;
  gameFileId?: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
  percentage: number;
  status: DownloadStatus;
  etaSeconds?: number;
  retryCount?: number;
  nextRetryInSeconds?: number;
}

export interface DownloadStateChangedEvent {
  downloadId: string;
  gameId: string;
  gameFileId?: string;
  status: DownloadStatus;
  error?: string;
  errorReason?: string;
  retryCount?: number;
  nextRetryInSeconds?: number;
}

export type EmulatorAdapterType =
  | 'pcsx2'
  | 'dolphin'
  | 'duckstation'
  | 'ppsspp'
  | 'retroarch'
  | 'custom';

export type LauncherType = 'emulator' | 'native_pc';

export interface Emulator {
  id: string;
  name: string;
  adapterType?: EmulatorAdapterType;
  executablePath: string;
  supportedPlatforms?: GamePlatform[];
  defaultArgs?: string;
  fullscreenArgs?: string;
  workingDirectory?: string;
  version?: string;
  detected?: boolean;
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
  // Backward compatibility fields
  platform?: GamePlatform;
  isInstalled?: boolean;
  configPath?: string;
}

export interface LaunchProfile {
  id: string;
  gameId: string;
  launcherType: LauncherType;
  emulatorId?: string;
  executablePath?: string;
  argumentsTemplate?: string;
  workingDirectory?: string;
  fullscreen: boolean;
  playbackMode?: PlaybackMode;
  createdAt: string;
  updatedAt: string;
}

export interface GameSession {
  id: string;
  gameId: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  launcherType: LauncherType;
  emulatorId?: string;
  exitCode?: number;
  crashed: boolean;
  createdAt: string;
}

export interface LaunchCommand {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface GameRunningStateEvent {
  gameId: string;
  sessionId?: string;
  isRunning: boolean;
  startedAt?: string;
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
  lastSeenRunId?: string;
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

// --- Phase 3C: Preparation & Smart Cache Types ---

export type PreparationJobStatus =
  | 'QUEUED'
  | 'EXTRACTING'
  | 'VALIDATING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface PreparationJob {
  id: string;
  gameId: string;
  status: PreparationJobStatus;
  step?: string;
  progressPercentage: number;
  totalBytes: number;
  processedBytes: number;
  tempDir?: string;
  destinationDir?: string;
  primaryFilePath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PreparationProgressEvent {
  jobId: string;
  gameId: string;
  status: PreparationJobStatus;
  step?: string;
  progressPercentage: number;
  totalBytes: number;
  processedBytes: number;
  message?: string;
}

export type ManifestFileRole = 'PRIMARY' | 'TRACK' | 'AUXILIARY' | 'DOCUMENT' | 'INSTALLER';

export interface ManifestFileEntry {
  path?: string;
  relativePath: string;
  sizeBytes: number;
  md5Checksum?: string;
  role: ManifestFileRole;
}

export interface GameManifest {
  gameId: string;
  title: string;
  platform: GamePlatform;
  preparedAt: string;
  primaryExecutableOrRom: string;
  totalLocalSize: number;
  installRequired?: boolean;
  files: ManifestFileEntry[];
  sourceArtifactIds?: string[];
  integrityStatus: 'VERIFIED' | 'UNVERIFIED' | 'CORRUPTED';
}

export type CacheCategory = 'PARTIAL' | 'TEMP' | 'GAME' | 'ARTWORK';

export interface CacheBreakdown {
  partialBytes: number;
  tempBytes: number;
  gameBytes: number;
  artworkBytes: number;
  totalBytes: number;
  freeDiskBytes: number;
  configuredLimitBytes: number;
  cachedGamesCount: number;
}

export interface EvictionCandidate {
  game: Game;
  localSizeBytes: number;
  lastPlayedAt?: string;
  lastAccessedAt?: string;
  pinned: boolean;
}

export type PlaybackStrategy = 'INSTANT_HYDRATION' | 'PROGRESSIVE_PLAY' | 'LOCAL_REQUIRED';
export type PlaybackMode = 'auto' | 'always_local' | 'experimental_streaming';
export type NetworkQuality = 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT';

export interface RangeReadResult {
  data: Buffer;
  contentRange?: string;
  totalSize?: number;
}

export interface StreamingBlockManifest {
  fileId: string;
  remoteFileId: string;
  accountId: string;
  expectedSize: number;
  blockSize: number;
  blockCount: number;
  remoteVersion: string;
  cachedBlocks: number[];
  createdAt: string;
  updatedAt: string;
}

export interface StreamingMetrics {
  averageRangeLatencyMs: number;
  rangeThroughputBps: number;
  cacheHitRate: number;
  prefetchHitRate: number;
  stallsCount: number;
  bytesFetched: number;
  bytesPrefetched: number;
  wastedPrefetchBytes: number;
}

export interface EffectivePlaybackStrategy {
  strategy: PlaybackStrategy;
  reason: string;
  estimatedHydrationTimeMs?: number;
  isStreamable?: boolean;
}

// ============================================================================
// Phase 5A: Metadata & Artwork Pipeline Types
// ============================================================================

export type MatchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';
export type MetadataSourceStatus = 'MATCHED' | 'REVIEW_REQUIRED' | 'SKIPPED' | 'REJECTED' | 'USER_CONFIRMED';
export type MetadataJobStatus =
  | 'QUEUED'
  | 'SEARCHING'
  | 'MATCHED'
  | 'DOWNLOADING_MEDIA'
  | 'COMPLETED'
  | 'REVIEW_REQUIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED';
export type MetadataJobPriority = 'USER_REQUESTED' | 'NORMAL' | 'BACKGROUND';

export type GameArtworkType =
  | 'COVER_FRONT'
  | 'COVER_BACK'
  | 'BOX_3D'
  | 'LOGO'
  | 'BACKGROUND'
  | 'SCREENSHOT'
  | 'TITLE_SCREEN'
  | 'FANART'
  | 'ICON'
  | 'VIDEO'
  | 'MANUAL';

export interface GameMetadata {
  gameId: string;
  canonicalTitle?: string;
  sortTitle?: string;
  description?: string;
  releaseDate?: string;
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  genres?: string[];
  players?: string;
  rating?: number;
  region?: string;
  language?: string;
  sourceSummary?: string;
  userOverrideFlags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GameMetadataSource {
  id: string;
  gameId: string;
  providerId: string;
  providerGameId: string;
  connectionId?: string;
  confidence: MatchConfidence;
  matchSignals?: Record<string, unknown>;
  matchedAt: string;
  lastSyncedAt?: string;
  sourceDataHash?: string;
  status: MetadataSourceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GameArtwork {
  id: string;
  gameId: string;
  type: GameArtworkType;
  provider: string;
  providerMediaId?: string;
  sourceUrl?: string;
  localPath: string;
  width?: number;
  height?: number;
  mimeType?: string;
  fileSize?: number;
  checksum?: string;
  isPrimary: boolean;
  isUserCustom: boolean;
  status: 'CACHED' | 'MISSING' | 'PENDING';
  createdAt: string;
  updatedAt: string;
}

export interface GameIdentityQuery {
  gameId: string;
  title: string;
  cleanTitle: string;
  platform: GamePlatform | string;
  normalizedPlatform: GamePlatform | string;
  filename?: string;
  romFilename?: string;
  extension?: string;
  region?: string;
  discNumber?: number;
  revision?: string;
  serial?: string;
  hash?: string;
  md5?: string;
  sha1?: string;
  crc?: string;
  releaseYearHint?: number;
  systemId?: string | number;
}

export interface MetadataCandidate {
  provider: string;
  providerGameId: string;
  title: string;
  platform?: string;
  releaseDate?: string;
  releaseYear?: number;
  region?: string;
  developer?: string;
  publisher?: string;
  description?: string;
  genres?: string[];
  rating?: number;
  coverUrl?: string;
  logoUrl?: string;
  backgroundUrl?: string;
  screenshotUrls?: string[];
  matchSignals: {
    titleScore: number;
    platformMatch: boolean;
    regionMatch?: boolean;
    yearMatch?: boolean;
    serialMatch?: boolean;
    hashMatch?: boolean;
    filenameSimilarity?: number;
  };
  totalScore: number;
  confidence: MatchConfidence;
}

