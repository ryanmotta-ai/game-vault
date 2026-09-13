import crypto from 'node:crypto';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameMetadataRepository, GameMetadataRecord } from '../database/repositories/gameMetadataRepository';
import { GameMetadataSourcesRepository, GameMetadataSourceRecord } from '../database/repositories/gameMetadataSourcesRepository';
import {
  GameMetadata,
  GameMetadataSource,
  MetadataCandidate,
  MetadataSourceStatus
} from './types';
import { logger } from '../core/logger';

export interface MetadataMergeResult {
  metadata: GameMetadata;
  source: GameMetadataSource;
}

export class MetadataMergeService {
  private log = logger.child('MetadataMergeService');

  constructor(
    private metadataRepo: GameMetadataRepository,
    private sourcesRepo: GameMetadataSourcesRepository,
    private gamesRepo: GamesRepository
  ) {}

  /**
   * Applies candidate metadata to a game while strictly respecting user override flags.
   * Remote metadata never overwrites fields explicitly edited or protected by the user.
   */
  public applyCandidate(
    gameId: string,
    candidate: MetadataCandidate,
    options?: {
      status?: MetadataSourceStatus;
      isUserConfirmed?: boolean;
      connectionId?: string;
    }
  ): MetadataMergeResult {
    const existingGame = this.gamesRepo.getById(gameId);
    if (!existingGame) {
      throw new Error(`Game '${gameId}' not found when applying metadata candidate.`);
    }

    const existingMeta = this.metadataRepo.getByGameId(gameId);
    const overriddenFields = new Set(this.metadataRepo.getOverriddenFields(gameId));

    const status: MetadataSourceStatus = options?.status || (
      options?.isUserConfirmed
        ? 'USER_CONFIRMED'
        : (candidate.confidence === 'EXACT' || candidate.confidence === 'HIGH'
            ? 'MATCHED'
            : 'REVIEW_REQUIRED')
    );

    const now = new Date().toISOString();

    // 1. Record provenance in game_metadata_sources
    const sourceRecord: GameMetadataSourceRecord = {
      id: crypto.randomUUID(),
      gameId,
      providerId: candidate.provider,
      providerGameId: candidate.providerGameId,
      connectionId: options?.connectionId,
      confidence: candidate.confidence,
      matchSignalsJson: JSON.stringify(candidate.matchSignals || {}),
      matchedAt: now,
      lastSyncedAt: now,
      status,
      createdAt: now,
      updatedAt: now
    };

    this.sourcesRepo.upsert(sourceRecord);

    // 2. Determine field values with strict override protection
    const canonicalTitle = overriddenFields.has('title')
      ? (existingMeta?.canonicalTitle || existingGame.title)
      : (candidate.title || existingGame.title);

    const description = overriddenFields.has('description')
      ? (existingMeta?.description || existingGame.description)
      : (candidate.description ?? existingMeta?.description ?? existingGame.description);

    const releaseYear = overriddenFields.has('releaseYear')
      ? (existingMeta?.releaseYear ?? existingGame.releaseYear)
      : (candidate.releaseYear ?? existingMeta?.releaseYear ?? existingGame.releaseYear);

    const releaseDate = overriddenFields.has('releaseDate')
      ? (existingMeta?.releaseDate)
      : (candidate.releaseDate ?? existingMeta?.releaseDate);

    const developer = overriddenFields.has('developer')
      ? (existingMeta?.developer || existingGame.developer)
      : (candidate.developer ?? existingMeta?.developer ?? existingGame.developer);

    const publisher = overriddenFields.has('publisher')
      ? (existingMeta?.publisher || existingGame.publisher)
      : (candidate.publisher ?? existingMeta?.publisher ?? existingGame.publisher);

    let genres: string[] | undefined = existingGame.genres;
    if (overriddenFields.has('genres')) {
      if (existingMeta?.genresJson) {
        try {
          genres = JSON.parse(existingMeta.genresJson);
        } catch {}
      }
    } else if (candidate.genres && candidate.genres.length > 0) {
      genres = candidate.genres;
    }

    const rating = overriddenFields.has('rating')
      ? (existingMeta?.rating ?? existingGame.rating)
      : (candidate.rating ?? existingMeta?.rating ?? existingGame.rating);

    const region = overriddenFields.has('region')
      ? existingMeta?.region
      : (candidate.region ?? existingMeta?.region);

    const sourceSummary = `${candidate.provider}:${candidate.providerGameId} (${candidate.confidence})`;

    // 3. Upsert into game_metadata table
    const metaRecord: GameMetadataRecord = {
      gameId,
      canonicalTitle,
      description,
      releaseDate,
      releaseYear,
      developer,
      publisher,
      genresJson: genres ? JSON.stringify(genres) : undefined,
      rating,
      region,
      sourceSummary,
      userOverrideFlags: JSON.stringify(Array.from(overriddenFields)),
      createdAt: existingMeta?.createdAt || now,
      updatedAt: now
    };

    this.metadataRepo.upsert(metaRecord);

    // 4. Mirror key fields back to the primary games table
    this.gamesRepo.updateMetadata(gameId, {
      title: !overriddenFields.has('title') && canonicalTitle ? canonicalTitle : undefined,
      description,
      releaseYear,
      developer,
      publisher,
      genres,
      rating,
      coverUrl: overriddenFields.has('coverUrl') ? existingGame.coverUrl : (candidate.coverUrl || existingGame.coverUrl),
      bannerUrl: overriddenFields.has('bannerUrl') ? existingGame.bannerUrl : (candidate.backgroundUrl || existingGame.bannerUrl),
      metadataSource: candidate.provider,
      metadataScrapedAt: now
    });

    this.log.info(
      `Applied metadata candidate '${canonicalTitle}' for game '${gameId}' from provider '${candidate.provider}' (status: ${status})`
    );

    return {
      metadata: {
        gameId,
        canonicalTitle,
        description,
        releaseDate,
        releaseYear,
        developer,
        publisher,
        genres,
        rating,
        region,
        sourceSummary,
        userOverrideFlags: Array.from(overriddenFields),
        createdAt: metaRecord.createdAt,
        updatedAt: metaRecord.updatedAt
      },
      source: {
        id: sourceRecord.id,
        gameId,
        providerId: sourceRecord.providerId,
        providerGameId: sourceRecord.providerGameId,
        connectionId: sourceRecord.connectionId,
        confidence: sourceRecord.confidence,
        matchSignals: candidate.matchSignals,
        matchedAt: sourceRecord.matchedAt,
        lastSyncedAt: sourceRecord.lastSyncedAt,
        status: sourceRecord.status,
        createdAt: sourceRecord.createdAt,
        updatedAt: sourceRecord.updatedAt
      }
    };
  }

  /**
   * Sets a manual user override for a specific field, protecting it from future remote wipes.
   */
  public setUserOverride(gameId: string, field: string, value: any): void {
    this.metadataRepo.addOverrideFlag(gameId, field);

    const now = new Date().toISOString();
    const existing = this.metadataRepo.getByGameId(gameId) || {
      gameId,
      createdAt: now,
      updatedAt: now
    };

    const updated: GameMetadataRecord = {
      ...existing,
      updatedAt: now
    };

    if (field === 'title') {
      updated.canonicalTitle = String(value);
      this.gamesRepo.updateMetadata(gameId, { title: String(value) });
    } else if (field === 'description') {
      updated.description = String(value);
      this.gamesRepo.updateMetadata(gameId, { description: String(value) });
    } else if (field === 'releaseYear') {
      updated.releaseYear = Number(value);
      this.gamesRepo.updateMetadata(gameId, { releaseYear: Number(value) });
    } else if (field === 'developer') {
      updated.developer = String(value);
      this.gamesRepo.updateMetadata(gameId, { developer: String(value) });
    } else if (field === 'publisher') {
      updated.publisher = String(value);
      this.gamesRepo.updateMetadata(gameId, { publisher: String(value) });
    } else if (field === 'rating') {
      updated.rating = Number(value);
      this.gamesRepo.updateMetadata(gameId, { rating: Number(value) });
    } else if (field === 'coverUrl') {
      this.gamesRepo.updateMetadata(gameId, { coverUrl: String(value) });
    }

    this.metadataRepo.upsert(updated);
    this.log.info(`User override flag added for game '${gameId}' field '${field}'`);
  }

  /**
   * Clears a manual user override flag.
   */
  public removeUserOverride(gameId: string, field: string): void {
    const existing = this.metadataRepo.getByGameId(gameId);
    if (!existing) return;

    const current = this.metadataRepo.getOverriddenFields(gameId);
    const updated = current.filter((f) => f !== field);

    this.metadataRepo.upsert({
      ...existing,
      userOverrideFlags: JSON.stringify(updated),
      updatedAt: new Date().toISOString()
    });
    this.log.info(`User override flag removed for game '${gameId}' field '${field}'`);
  }

  public getMetadata(gameId: string): GameMetadata | null {
    const rec = this.metadataRepo.getByGameId(gameId);
    if (!rec) return null;

    let genres: string[] | undefined;
    if (rec.genresJson) {
      try {
        genres = JSON.parse(rec.genresJson);
      } catch {}
    }

    let userOverrideFlags: string[] = [];
    if (rec.userOverrideFlags) {
      try {
        userOverrideFlags = JSON.parse(rec.userOverrideFlags);
      } catch {}
    }

    return {
      gameId: rec.gameId,
      canonicalTitle: rec.canonicalTitle,
      sortTitle: rec.sortTitle,
      description: rec.description,
      releaseDate: rec.releaseDate,
      releaseYear: rec.releaseYear,
      developer: rec.developer,
      publisher: rec.publisher,
      genres,
      players: rec.players,
      rating: rec.rating,
      region: rec.region,
      language: rec.language,
      sourceSummary: rec.sourceSummary,
      userOverrideFlags,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    };
  }
}
