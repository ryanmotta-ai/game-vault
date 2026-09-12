import crypto from 'node:crypto';
import { Game, GameFile, GameCandidate, CandidateConfidence } from '../core/types';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { logger } from '../core/logger';

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface IngestionResult {
  gamesCreated: number;
  gamesUpdated: number;
  filesIngested: number;
  filesUpdated: number;
  skippedLowConfidence: number;
}

export class CatalogIngestionService {
  private log = logger.child('CatalogIngestion');

  constructor(
    private gamesRepo: GamesRepository,
    private gameFilesRepo: GameFilesRepository
  ) {}

  /**
   * Ingests validated game candidates into the games catalog and game_files table.
   * Only candidates with confidence HIGH (or optional threshold) are automatically ingested.
   */
  public async ingestCandidates(
    candidates: GameCandidate[],
    minConfidence: CandidateConfidence = 'HIGH'
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      gamesCreated: 0,
      gamesUpdated: 0,
      filesIngested: 0,
      filesUpdated: 0,
      skippedLowConfidence: 0
    };

    const allowedConfidences: CandidateConfidence[] =
      minConfidence === 'LOW'
        ? ['HIGH', 'MEDIUM', 'LOW']
        : minConfidence === 'MEDIUM'
        ? ['HIGH', 'MEDIUM']
        : ['HIGH'];

    for (const candidate of candidates) {
      if (!allowedConfidences.includes(candidate.confidence)) {
        result.skippedLowConfidence++;
        continue;
      }

      // 1. Generate unique collision-safe slug
      const baseSlug = slugify(candidate.normalizedTitle);
      const platformSlug = slugify(candidate.platform);
      const uniqueSlug = `${baseSlug}-${platformSlug}`;

      // 2. Check if game already exists in catalog
      let existingGame = this.gamesRepo.getBySlug(uniqueSlug);
      const now = new Date().toISOString();

      let gameId: string;
      if (existingGame) {
        gameId = existingGame.id;
        result.gamesUpdated++;
      } else {
        gameId = `game-${crypto.randomUUID()}`;
        const totalSize =
          candidate.primaryFile.sizeBytes +
          candidate.additionalFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

        const newGame: Game = {
          id: gameId,
          title: candidate.normalizedTitle,
          slug: uniqueSlug,
          platform: candidate.platform,
          state: 'CLOUD',
          sizeBytes: totalSize,
          playTimeSeconds: 0,
          createdAt: now,
          updatedAt: now
        };

        this.gamesRepo.upsert(newGame);
        existingGame = newGame;
        result.gamesCreated++;
      }

      // 3. Ingest primary file
      this.ingestSingleFile(candidate.primaryFile, gameId, result, now);

      // 4. Ingest additional associated files (e.g. tracks / discs)
      for (const addFile of candidate.additionalFiles) {
        this.ingestSingleFile(addFile, gameId, result, now);
      }
    }

    this.log.info(
      `Ingestion completed: ${result.gamesCreated} games created, ${result.gamesUpdated} games updated, ${result.filesIngested} files ingested, ${result.skippedLowConfidence} low-confidence files skipped.`
    );
    return result;
  }

  private ingestSingleFile(
    cloudFile: GameCandidate['primaryFile'],
    gameId: string,
    result: IngestionResult,
    now: string
  ): void {
    const existingFile = this.gameFilesRepo.getByRemoteFileId(
      cloudFile.storageAccountId,
      cloudFile.remoteFileId
    );

    if (existingFile) {
      // If remote path or filename changed (remote move/rename), update it without losing identity
      if (
        existingFile.remotePath !== cloudFile.remotePath ||
        existingFile.filename !== cloudFile.name
      ) {
        this.gameFilesRepo.updateRemotePath(existingFile.id, cloudFile.remotePath);
        result.filesUpdated++;
      }
    } else {
      const fileId = `file-${crypto.randomUUID()}`;
      const newFile: GameFile = {
        id: fileId,
        gameId,
        storageAccountId: cloudFile.storageAccountId,
        remoteFileId: cloudFile.remoteFileId,
        remotePath: cloudFile.remotePath,
        filename: cloudFile.name,
        sizeBytes: cloudFile.sizeBytes,
        md5Checksum: cloudFile.md5Checksum,
        status: 'REMOTE',
        createdAt: now,
        updatedAt: now
      };

      this.gameFilesRepo.upsert(newFile);
      result.filesIngested++;
    }
  }

  /**
   * Updates game file records when files are removed or moved in cloud storage.
   */
  public handleRemovedFiles(
    storageAccountId: string,
    removedRemoteFileIds: string[]
  ): void {
    for (const remoteId of removedRemoteFileIds) {
      const file = this.gameFilesRepo.getByRemoteFileId(storageAccountId, remoteId);
      if (file) {
        this.log.info(`File marked missing from remote: ${file.filename} (${file.id})`);
        // Keep catalog record non-destructively, but update status to MISSING
        this.gameFilesRepo.updateStatus(file.id, 'MISSING');
      }
    }
  }
}
