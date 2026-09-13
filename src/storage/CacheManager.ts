import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../core/logger';
import { configManager } from '../core/config';
import { LocalCacheInfo } from './types';
import { CacheBreakdown, EvictionCandidate } from '../core/types';
import { isSubPath, sanitizeFilename } from '../core/utils/pathSafety';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { SettingsRepository } from '../database/repositories/settingsRepository';

const DEFAULT_CACHE_LIMIT_BYTES = 500 * 1024 * 1024 * 1024; // 500 GB

export class CacheManager {
  private cacheDir: string;
  private log = logger.child('CacheManager');
  private settingsRepo?: SettingsRepository;

  constructor(customCacheDir?: string, settingsRepo?: SettingsRepository) {
    this.cacheDir = customCacheDir || configManager.get('cacheDir');
    this.settingsRepo = settingsRepo;
    this.ensureDirectoryStructure();
  }

  public setSettingsRepository(repo: SettingsRepository): void {
    this.settingsRepo = repo;
  }

  private ensureDirectoryStructure(): void {
    try {
      const dirs = [
        this.cacheDir,
        this.getPartialDownloadDir(),
        this.getTempPrepareDir(),
        this.getGamesDir(),
        this.getArtworkDir()
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) {
          fs.mkdirSync(d, { recursive: true });
        }
      }
    } catch (err) {
      this.log.error(`Failed to initialize cache directory structure at ${this.cacheDir}:`, err);
    }
  }

  public getCachePath(): string {
    return this.cacheDir;
  }

  public setCustomCacheDir(newDir: string): void {
    if (!newDir || typeof newDir !== 'string') {
      throw new Error('Valid directory path is required.');
    }
    const resolved = path.resolve(newDir);
    this.cacheDir = resolved;
    this.ensureDirectoryStructure();
    this.log.info(`Updated cache root directory to: ${this.cacheDir}`);
  }

  private customLimitBytes?: number;

  private validateId(id: string, label = 'id'): void {
    if (!id || typeof id !== 'string') {
      throw new Error(`Invalid ${label}: cannot be empty`);
    }
    if (id.includes('..') || id.includes('/') || id.includes('\\') || path.isAbsolute(id)) {
      throw new Error(`Invalid ${label}: path traversal characters are not permitted`);
    }
  }

  public getPartialDownloadDir(): string {
    return path.join(this.cacheDir, 'downloads', 'partial');
  }

  public getPartialFilePath(downloadId: string): string {
    return path.join(this.getPartialDownloadDir(), `${downloadId}.part`);
  }

  public getTempPrepareDir(jobId?: string): string {
    if (jobId) {
      this.validateId(jobId, 'jobId');
    }
    const base = path.join(this.cacheDir, 'prepare');
    return jobId ? path.join(base, jobId) : base;
  }

  public getPreparePath(jobId: string): string {
    return this.getTempPrepareDir(jobId);
  }

  public getGamesDir(): string {
    return path.join(this.cacheDir, 'games');
  }

  public getGameCacheDir(gameId: string): string {
    this.validateId(gameId, 'gameId');
    return path.join(this.getGamesDir(), gameId);
  }

  public getDownloadPath(gameId: string, filename: string): string {
    this.validateId(gameId, 'gameId');
    return path.join(this.cacheDir, 'downloads', gameId, sanitizeFilename(filename));
  }

  public getArtworkDir(): string {
    return path.join(this.cacheDir, 'artwork');
  }

  public getFinalGameFilePath(gameId: string, filename: string): string {
    this.validateId(gameId, 'gameId');
    const dir = this.getGameCacheDir(gameId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, sanitizeFilename(filename));
  }

  public getAvailableDiskSpace(): number {
    try {
      if (typeof fs.statfsSync === 'function') {
        const stat = fs.statfsSync(this.cacheDir);
        return stat.bavail * stat.bsize;
      }
    } catch (err) {
      this.log.warn('Could not query free disk space via statfsSync, using fallback estimate:', err);
    }
    return 50 * 1024 * 1024 * 1024; // 50GB fallback
  }

  public getCacheLimit(): number {
    if (this.settingsRepo) {
      const val = this.settingsRepo.get<number | string>('cache_max_bytes');
      if (val) {
        const parsed = typeof val === 'number' ? val : parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
      }
    }
    return this.customLimitBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
  }

  public setCacheLimit(limitBytes: number): void {
    if (limitBytes <= 0) {
      throw new Error('Cache limit must be greater than 0 bytes.');
    }
    this.customLimitBytes = limitBytes;
    if (this.settingsRepo) {
      this.settingsRepo.set('cache_max_bytes', limitBytes.toString());
    }
  }

  public verifyLocalFile(localPath?: string, expectedSize?: number, expectedMd5?: string): boolean {
    if (!localPath || typeof localPath !== 'string') return false;
    try {
      if (!fs.existsSync(localPath)) return false;
      const stat = fs.statSync(localPath);
      if (!stat.isFile()) return false;
      if (stat.size === 0) return false;
      if (expectedSize !== undefined && expectedSize > 0) {
        if (stat.size !== expectedSize) return false;
      }
      if (expectedMd5) {
        const buf = fs.readFileSync(localPath);
        const hash = crypto.createHash('md5').update(buf).digest('hex');
        if (hash.toLowerCase() !== expectedMd5.toLowerCase()) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  public calculateDirSize(dirPath: string): number {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;
    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
          size += this.calculateDirSize(fullPath);
        } else {
          const stat = fs.statSync(fullPath);
          size += stat.size;
        }
      }
    } catch {
      // Ignore transient access errors
    }
    return size;
  }

  public getCacheBreakdown(): CacheBreakdown {
    this.ensureDirectoryStructure();

    const partialBytes = this.calculateDirSize(this.getPartialDownloadDir());
    const tempBytes = this.calculateDirSize(this.getTempPrepareDir());
    const gameBytes = this.calculateDirSize(this.getGamesDir());
    const artworkBytes = this.calculateDirSize(this.getArtworkDir());
    const totalBytes = partialBytes + tempBytes + gameBytes + artworkBytes;

    let cachedGamesCount = 0;
    const gamesDir = this.getGamesDir();
    if (fs.existsSync(gamesDir)) {
      try {
        const entries = fs.readdirSync(gamesDir, { withFileTypes: true });
        cachedGamesCount = entries.filter((e) => e.isDirectory()).length;
      } catch {
        // Ignore
      }
    }

    return {
      partialBytes,
      tempBytes,
      gameBytes,
      artworkBytes,
      totalBytes,
      freeDiskBytes: this.getAvailableDiskSpace(),
      configuredLimitBytes: this.getCacheLimit(),
      cachedGamesCount
    };
  }

  public getCacheInfo(): LocalCacheInfo {
    const breakdown = this.getCacheBreakdown();
    return {
      path: this.cacheDir,
      totalSizeBytes: breakdown.totalBytes,
      freeDiskBytes: breakdown.freeDiskBytes,
      cachedGamesCount: breakdown.cachedGamesCount
    };
  }

  /**
   * Secure deletion helper.
   * Validates canonical paths to ensure files/directories strictly reside inside this.cacheDir.
   * Prevents deleting root or escaping outside cacheDir.
   */
  public safeDelete(targetPath: string): void {
    if (!targetPath || typeof targetPath !== 'string') return;
    if (!fs.existsSync(targetPath)) return;

    const canonicalCache = fs.existsSync(this.cacheDir) ? fs.realpathSync(this.cacheDir) : path.resolve(this.cacheDir);
    const canonicalTarget = fs.realpathSync(targetPath);

    if (canonicalCache.toLowerCase() === canonicalTarget.toLowerCase()) {
      throw new Error(`Security violation: Attempted deletion of root cache directory: ${targetPath}`);
    }

    if (!isSubPath(canonicalCache, canonicalTarget)) {
      throw new Error(`Security violation: Target path '${targetPath}' is outside cache directory '${this.cacheDir}'.`);
    }

    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      this.log.info(`Safely deleted cache path: ${targetPath}`);
    } catch (err) {
      this.log.error(`Failed to safe-delete path: ${targetPath}`, err);
      throw err;
    }
  }

  /**
   * Manual Eviction / [ Remove Local Copy ] action for a game.
   * Deletes local files from disk, resets game_files status to REMOTE,
   * updates Game state to CLOUD, while strictly preserving playtime, metadata, and cloud files.
   */
  public removeLocalCopy(
    gameId: string,
    repos?: {
      gamesRepo?: GamesRepository;
      gameFilesRepo?: GameFilesRepository;
    }
  ): { freedBytes: number } {
    if (!gameId) throw new Error('Game ID is required to remove local copy.');

    const gameDir = this.getGameCacheDir(gameId);
    let freedBytes = 0;

    if (fs.existsSync(gameDir)) {
      freedBytes = this.calculateDirSize(gameDir);
      this.safeDelete(gameDir);
    }

    // Also clean any temporary prepare folders for this game
    const prepareDir = this.getTempPrepareDir();
    if (fs.existsSync(prepareDir)) {
      try {
        const entries = fs.readdirSync(prepareDir);
        for (const entry of entries) {
          if (entry.includes(gameId)) {
            const folder = path.join(prepareDir, entry);
            this.safeDelete(folder);
          }
        }
      } catch {
        // Ignore
      }
    }

    // Update database records
    if (repos?.gameFilesRepo) {
      const files = repos.gameFilesRepo.getByGameId(gameId);
      for (const file of files) {
        repos.gameFilesRepo.updateStatus(file.id, 'REMOTE', undefined);
      }
    }

    if (repos?.gamesRepo) {
      repos.gamesRepo.updateState(gameId, 'CLOUD', null);
    }

    this.log.info(`Evicted local copy of game ${gameId}. Freed ${freedBytes} bytes. Cloud records preserved.`);
    return { freedBytes };
  }

  /**
   * Retrieves ordered eviction candidates for LRU cache reclamation.
   * Never includes pinned games.
   * Orders by:
   * 1. not pinned
   * 2. oldest lastPlayedAt / lastAccessedAt
   * 3. largest useful candidates
   */
  public getEvictionCandidates(
    requiredBytes: number,
    gamesRepo: GamesRepository
  ): EvictionCandidate[] {
    const candidates = gamesRepo.getEvictionCandidates(true);
    const result: EvictionCandidate[] = [];
    let accumulatedBytes = 0;

    for (const game of candidates) {
      const gameDir = this.getGameCacheDir(game.id);
      const localSize = fs.existsSync(gameDir) ? this.calculateDirSize(gameDir) : game.sizeBytes;

      const cand: EvictionCandidate = {
        game,
        localSizeBytes: localSize,
        lastPlayedAt: game.lastPlayedAt,
        lastAccessedAt: game.lastAccessedAt,
        pinned: Boolean(game.pinned)
      };

      result.push(cand);
      accumulatedBytes += localSize;

      if (requiredBytes > 0 && accumulatedBytes >= requiredBytes) {
        break;
      }
    }

    return result;
  }

  public cleanTempPreparation(jobId?: string): void {
    if (jobId) {
      const specificDir = this.getTempPrepareDir(jobId);
      if (fs.existsSync(specificDir)) {
        this.safeDelete(specificDir);
      }
    } else {
      const prepareDir = this.getTempPrepareDir();
      if (fs.existsSync(prepareDir)) {
        try {
          const entries = fs.readdirSync(prepareDir);
          for (const entry of entries) {
            const target = path.join(prepareDir, entry);
            this.safeDelete(target);
          }
        } catch (err) {
          this.log.error('Failed to clean temp prepare directory:', err);
        }
      }
    }
  }

  public clearCache(): void {
    try {
      this.safeDelete(this.getGamesDir());
      this.safeDelete(this.getPartialDownloadDir());
      this.cleanTempPreparation();
      this.ensureDirectoryStructure();
      this.log.info('Local cache cleared successfully.');
    } catch (err) {
      this.log.error('Failed to clear cache:', err);
    }
  }
}

export const cacheManager = new CacheManager();
