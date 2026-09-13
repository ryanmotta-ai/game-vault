import fs from 'node:fs';
import path from 'node:path';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { GameManifestsRepository } from '../database/repositories/gameManifestsRepository';
import { StorageManager } from '../storage/StorageManager';
import { CacheManager } from '../storage/CacheManager';
import { GameManifest, Game } from '../core/types';
import { NotFoundError, StreamingError } from '../core/errors/AppError';
import { logger } from '../core/logger';

export interface HydrationProgress {
  gameId: string;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

export class InstantHydrationService {
  private log = logger.child('InstantHydrationService');

  constructor(
    private gamesRepo: GamesRepository,
    private gameFilesRepo: GameFilesRepository,
    private manifestsRepo: GameManifestsRepository,
    private storageManager: StorageManager,
    private cacheManager: CacheManager
  ) {}

  public async hydrateGame(
    gameId: string,
    onProgress?: (progress: HydrationProgress) => void
  ): Promise<Game> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found: ${gameId}`);
    }

    if (game.state === 'READY' && game.installedPath && fs.existsSync(game.installedPath)) {
      return game;
    }

    const files = this.gameFilesRepo.getByGameId(gameId);
    if (files.length === 0) {
      throw new StreamingError(`No cloud files found for game "${game.title}" (${gameId}).`);
    }

    const primaryFile = files[0];
    const provider = this.storageManager.getProvider(primaryFile.storageAccountId);
    if (!provider) {
      throw new StreamingError(
        `Storage provider for account "${primaryFile.storageAccountId}" is not available.`
      );
    }

    this.log.info(`Hydrating game "${game.title}" (${game.id}) from cloud...`);
    this.gamesRepo.updateState(gameId, 'DOWNLOADING', undefined);

    const gameCacheDir = this.cacheManager.getGameCacheDir(gameId);
    if (!fs.existsSync(gameCacheDir)) {
      fs.mkdirSync(gameCacheDir, { recursive: true });
    }

    const destinationPath = path.join(gameCacheDir, primaryFile.filename);

    try {
      await provider.download(
        {
          fileId: primaryFile.remoteFileId,
          destinationPath,
          expectedSize: primaryFile.sizeBytes
        },
        (dlProgress) => {
          onProgress?.({
            gameId,
            bytesTransferred: dlProgress.bytesTransferred,
            totalBytes: dlProgress.totalBytes,
            percentage: dlProgress.percentage
          });
        }
      );

      // Generate local manifest
      const now = new Date().toISOString();
      const manifest: GameManifest = {
        gameId: game.id,
        title: game.title,
        platform: game.platform,
        preparedAt: now,
        primaryExecutableOrRom: primaryFile.filename,
        totalLocalSize: primaryFile.sizeBytes,
        files: [
          {
            relativePath: primaryFile.filename,
            sizeBytes: primaryFile.sizeBytes,
            role: 'PRIMARY'
          }
        ],
        integrityStatus: 'VERIFIED'
      };

      this.manifestsRepo.upsert(manifest);
      fs.writeFileSync(
        path.join(gameCacheDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      // Update game file and game state to READY
      this.gameFilesRepo.updateStatus(primaryFile.id, 'CACHED_LOCAL', destinationPath);
      this.gamesRepo.updateState(gameId, 'READY', destinationPath);

      this.log.info(`Instant hydration complete for "${game.title}". Game is READY.`);
      return this.gamesRepo.getById(gameId)!;
    } catch (err: any) {
      this.log.error(`Instant hydration failed for "${game.title}":`, err.message);
      this.gamesRepo.updateState(gameId, 'CLOUD', undefined);
      throw err;
    }
  }
}
