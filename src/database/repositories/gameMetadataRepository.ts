import { Database } from 'better-sqlite3';

export interface GameMetadataRecord {
  gameId: string;
  canonicalTitle?: string;
  sortTitle?: string;
  description?: string;
  releaseDate?: string;
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  genresJson?: string;
  players?: string;
  rating?: number;
  region?: string;
  language?: string;
  sourceSummary?: string;
  userOverrideFlags?: string; // JSON array of field names, e.g. ["title", "cover", "description"]
  createdAt: string;
  updatedAt: string;
}

export class GameMetadataRepository {
  constructor(private db: Database) {}

  public getByGameId(gameId: string): GameMetadataRecord | null {
    const row = this.db
      .prepare('SELECT * FROM game_metadata WHERE game_id = ?')
      .get(gameId) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public upsert(record: GameMetadataRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO game_metadata (
          game_id, canonical_title, sort_title, description, release_date, release_year,
          developer, publisher, genres_json, players, rating, region, language,
          source_summary, user_override_flags, created_at, updated_at
        ) VALUES (
          @gameId, @canonicalTitle, @sortTitle, @description, @releaseDate, @releaseYear,
          @developer, @publisher, @genresJson, @players, @rating, @region, @language,
          @sourceSummary, @userOverrideFlags, @createdAt, @updatedAt
        )
        ON CONFLICT(game_id) DO UPDATE SET
          canonical_title = COALESCE(excluded.canonical_title, canonical_title),
          sort_title = COALESCE(excluded.sort_title, sort_title),
          description = COALESCE(excluded.description, description),
          release_date = COALESCE(excluded.release_date, release_date),
          release_year = COALESCE(excluded.release_year, release_year),
          developer = COALESCE(excluded.developer, developer),
          publisher = COALESCE(excluded.publisher, publisher),
          genres_json = COALESCE(excluded.genres_json, genres_json),
          players = COALESCE(excluded.players, players),
          rating = COALESCE(excluded.rating, rating),
          region = COALESCE(excluded.region, region),
          language = COALESCE(excluded.language, language),
          source_summary = COALESCE(excluded.source_summary, source_summary),
          user_override_flags = COALESCE(excluded.user_override_flags, user_override_flags),
          updated_at = excluded.updated_at
      `)
      .run({
        gameId: record.gameId,
        canonicalTitle: record.canonicalTitle ?? null,
        sortTitle: record.sortTitle ?? null,
        description: record.description ?? null,
        releaseDate: record.releaseDate ?? null,
        releaseYear: record.releaseYear ?? null,
        developer: record.developer ?? null,
        publisher: record.publisher ?? null,
        genresJson: record.genresJson ?? null,
        players: record.players ?? null,
        rating: record.rating ?? null,
        region: record.region ?? null,
        language: record.language ?? null,
        sourceSummary: record.sourceSummary ?? null,
        userOverrideFlags: record.userOverrideFlags ?? null,
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now
      });
  }

  public delete(gameId: string): void {
    this.db.prepare('DELETE FROM game_metadata WHERE game_id = ?').run(gameId);
  }

  public getOverriddenFields(gameId: string): string[] {
    const row = this.db
      .prepare('SELECT user_override_flags FROM game_metadata WHERE game_id = ?')
      .get(gameId) as { user_override_flags?: string } | undefined;

    if (!row?.user_override_flags) return [];
    try {
      return JSON.parse(row.user_override_flags);
    } catch {
      return [];
    }
  }

  public addOverrideFlag(gameId: string, field: string): void {
    const current = this.getOverriddenFields(gameId);
    if (!current.includes(field)) {
      current.push(field);
      const json = JSON.stringify(current);
      this.db
        .prepare('UPDATE game_metadata SET user_override_flags = ?, updated_at = ? WHERE game_id = ?')
        .run(json, new Date().toISOString(), gameId);
    }
  }

  private mapRow(row: any): GameMetadataRecord {
    return {
      gameId: row.game_id,
      canonicalTitle: row.canonical_title || undefined,
      sortTitle: row.sort_title || undefined,
      description: row.description || undefined,
      releaseDate: row.release_date || undefined,
      releaseYear: row.release_year !== null ? Number(row.release_year) : undefined,
      developer: row.developer || undefined,
      publisher: row.publisher || undefined,
      genresJson: row.genres_json || undefined,
      players: row.players || undefined,
      rating: row.rating !== null ? Number(row.rating) : undefined,
      region: row.region || undefined,
      language: row.language || undefined,
      sourceSummary: row.source_summary || undefined,
      userOverrideFlags: row.user_override_flags || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
