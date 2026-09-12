import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../core/logger';
import { configManager } from '../core/config';
import { LocalCacheInfo } from './types';

export class CacheManager {
  private cacheDir: string;
  private log = logger.child('CacheManager');

  constructor(customCacheDir?: string) {
    this.cacheDir = customCacheDir || configManager.get('cacheDir');
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.log.info(`Initialized local cache directory at: ${this.cacheDir}`);
      }
    } catch (err) {
      this.log.error(`Failed to create cache directory at ${this.cacheDir}:`, err);
    }
  }

  public getCachePath(): string {
    return this.cacheDir;
  }

  public getGameCacheDir(gameId: string): string {
    const dir = path.join(this.cacheDir, 'games', gameId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public getCacheInfo(): LocalCacheInfo {
    this.ensureDirectoryExists();
    let totalSize = 0;
    let cachedGames = 0;

    const gamesDir = path.join(this.cacheDir, 'games');
    if (fs.existsSync(gamesDir)) {
      try {
        const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true });
        for (const item of gameFolders) {
          if (item.isDirectory()) {
            cachedGames++;
            const folderPath = path.join(gamesDir, item.name);
            totalSize += this.calculateDirSize(folderPath);
          }
        }
      } catch (err) {
        this.log.error('Error scanning cache folder:', err);
      }
    }

    // Default estimate for free disk space: 50GB placeholder for Foundation
    const estimatedFree = 50 * 1024 * 1024 * 1024;

    return {
      path: this.cacheDir,
      totalSizeBytes: totalSize,
      freeDiskBytes: estimatedFree,
      cachedGamesCount: cachedGames
    };
  }

  private calculateDirSize(dirPath: string): number {
    let size = 0;
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

  public clearCache(): void {
    try {
      const gamesDir = path.join(this.cacheDir, 'games');
      if (fs.existsSync(gamesDir)) {
        fs.rmSync(gamesDir, { recursive: true, force: true });
        this.log.info('Cache cleared successfully.');
      }
    } catch (err) {
      this.log.error('Failed to clear cache:', err);
    }
  }
}

export const cacheManager = new CacheManager();
