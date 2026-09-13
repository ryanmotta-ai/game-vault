import fs from 'node:fs';
import { GameState } from '../core/types';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { DownloadsRepository } from '../database/repositories/downloadsRepository';
import { GameManifestsRepository } from '../database/repositories/gameManifestsRepository';
import { CacheManager } from '../storage/CacheManager';
import { logger } from '../core/logger';

export class GameAvailabilityService {
  private log = logger.child('GameAvailabilityService');

  constructor(
    private gamesRepo: GamesRepository,
    private gameFilesRepo: GameFilesRepository,
    private downloadsRepo?: DownloadsRepository,
    private cacheManager?: CacheManager,
    private manifestsRepo?: GameManifestsRepository
  ) {}

  public setDownloadsRepository(repo: DownloadsRepository): void {
    this.downloadsRepo = repo;
  }

  public setCacheManager(cache: CacheManager): void {
    this.cacheManager = cache;
  }

  public setManifestsRepository(repo: GameManifestsRepository): void {
    this.manifestsRepo = repo;
  }

  public getCacheManager(): CacheManager | undefined {
    return this.cacheManager;
  }

  /**
   * Recalculates and updates the GameState for a game based on its files, preparation, and download records.
   * PREPARING: an active preparation job is processing.
   * DOWNLOADING: at least one required file has an active, queued, or paused download.
   * READY: all required game_files are CACHED_LOCAL and verified on disk.
   * CLOUD: no active download and missing local files.
   */
  public recalculate(gameId: string): GameState {
    const game = this.gamesRepo.getById(gameId);
    if (!game) return 'CLOUD';

    // 1. Check if game is actively being prepared
    if (game.state === 'PREPARING') {
      return 'PREPARING';
    }

    // 2. Check if any file of this game has an active, queued, or paused download
    if (this.downloadsRepo) {
      const activeOrQueued = this.downloadsRepo.getActiveByGameId(gameId);
      if (activeOrQueued) {
        this.gamesRepo.updateState(gameId, 'DOWNLOADING', null);
        return 'DOWNLOADING';
      }
    }

    // 3. Phase 3C: Check if game has a valid manifest and installedPath exists on disk
    if (this.manifestsRepo) {
      const manifest = this.manifestsRepo.getByGameId(gameId);
      if (manifest && game.installedPath && fs.existsSync(game.installedPath)) {
        this.gamesRepo.updateState(gameId, 'READY', game.installedPath);
        return 'READY';
      }
    }

    // 4. Check files on disk
    const files = this.gameFilesRepo.getByGameId(gameId);
    if (files.length === 0) {
      this.gamesRepo.updateState(gameId, 'CLOUD', null);
      return 'CLOUD';
    }

    // A game is READY only if ALL required files are CACHED_LOCAL and physically valid on disk
    const allCached = files.every((f) => {
      if (f.status !== 'CACHED_LOCAL' || !f.localPath) return false;
      return this.verifyFileCheap(f.localPath);
    });

    if (allCached) {
      const mainPath = game.installedPath && fs.existsSync(game.installedPath)
        ? game.installedPath
        : files.find((f) => f.filename.toLowerCase().endsWith('.cue'))?.localPath || files[0].localPath;
      this.gamesRepo.updateState(gameId, 'READY', mainPath);
      return 'READY';
    }

    this.gamesRepo.updateState(gameId, 'CLOUD', null);
    return 'CLOUD';
  }

  /**
   * Cheap verification on startup / check: existence and matching file size.
   * Does NOT compute full MD5 across TBs of disk data.
   */
  public verifyFileCheap(filePath: string, expectedSize?: number): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      if (expectedSize !== undefined && expectedSize > 0) {
        const stat = fs.statSync(filePath);
        return stat.size === expectedSize;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verifies all games on startup cheaply and heals states if files were moved or deleted.
   */
  public verifyAllLocalGamesOnStartup(): { verified: number; healed: number } {
    const games = this.gamesRepo.getAll();
    let verified = 0;
    let healed = 0;

    for (const game of games) {
      if (game.state === 'READY') {
        let valid = false;
        if (this.manifestsRepo) {
          const manifest = this.manifestsRepo.getByGameId(game.id);
          if (manifest && game.installedPath && fs.existsSync(game.installedPath)) {
            valid = true;
          }
        }
        if (!valid) {
          const files = this.gameFilesRepo.getByGameId(game.id);
          valid =
            files.length > 0 && files.every((f) => f.localPath && this.verifyFileCheap(f.localPath));
        }

        if (!valid) {
          this.log.warn(
            `Game "${game.title}" was marked READY but files are missing/invalid on disk. Reverting to CLOUD.`
          );
          this.recalculate(game.id);
          healed++;
        } else {
          verified++;
        }
      }
    }

    return { verified, healed };
  }
}
