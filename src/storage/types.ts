export interface LocalCacheInfo {
  path: string;
  totalSizeBytes: number;
  freeDiskBytes: number;
  cachedGamesCount: number;
}

export interface CacheEntry {
  gameId: string;
  filename: string;
  localPath: string;
  sizeBytes: number;
  lastAccessedAt: string;
}
