import type { Database } from 'better-sqlite3';
import { Game, GamePlatform, GameState } from '../../core/types';

interface GameRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  banner_url: string | null;
  platform: string;
  release_year: number | null;
  developer: string | null;
  publisher: string | null;
  state: string;
  size_bytes: number;
  installed_path: string | null;
  play_time_seconds: number;
  last_played_at: string | null;
  last_accessed_at: string | null;
  pinned: number;
  genres: string | null;
  rating: number | null;
  screenshot_urls: string | null;
  local_cover_path: string | null;
  local_banner_path: string | null;
  local_screenshot_paths: string | null;
  metadata_source: string | null;
  metadata_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapRowToGame(row: GameRow): Game {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    bannerUrl: row.banner_url ?? undefined,
    platform: row.platform as GamePlatform,
    releaseYear: row.release_year ?? undefined,
    developer: row.developer ?? undefined,
    publisher: row.publisher ?? undefined,
    state: row.state as GameState,
    sizeBytes: row.size_bytes,
    installedPath: row.installed_path ?? undefined,
    playTimeSeconds: row.play_time_seconds,
    lastPlayedAt: row.last_played_at ?? undefined,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    pinned: row.pinned === 1,
    genres: row.genres ? safeParseJson<string[]>(row.genres, []) : undefined,
    rating: row.rating !== null && row.rating !== undefined ? row.rating : undefined,
    screenshotUrls: row.screenshot_urls ? safeParseJson<string[]>(row.screenshot_urls, []) : undefined,
    localCoverPath: row.local_cover_path ?? undefined,
    localBannerPath: row.local_banner_path ?? undefined,
    localScreenshotPaths: row.local_screenshot_paths ? safeParseJson<string[]>(row.local_screenshot_paths, []) : undefined,
    metadataSource: row.metadata_source ?? undefined,
    metadataScrapedAt: row.metadata_scraped_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class GamesRepository {
  constructor(private db: Database) {}

  public getAll(): Game[] {
    const stmt = this.db.prepare('SELECT * FROM games ORDER BY title ASC');
    const rows = stmt.all() as GameRow[];
    return rows.map(mapRowToGame);
  }

  public getById(id: string): Game | null {
    const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
    const row = stmt.get(id) as GameRow | undefined;
    return row ? mapRowToGame(row) : null;
  }

  public getBySlug(slug: string): Game | null {
    const stmt = this.db.prepare('SELECT * FROM games WHERE slug = ?');
    const row = stmt.get(slug) as GameRow | undefined;
    return row ? mapRowToGame(row) : null;
  }

  public getByState(state: GameState): Game[] {
    const stmt = this.db.prepare('SELECT * FROM games WHERE state = ? ORDER BY title ASC');
    const rows = stmt.all(state) as GameRow[];
    return rows.map(mapRowToGame);
  }

  public getByPlatform(platform: GamePlatform): Game[] {
    const stmt = this.db.prepare('SELECT * FROM games WHERE platform = ? ORDER BY title ASC');
    const rows = stmt.all(platform) as GameRow[];
    return rows.map(mapRowToGame);
  }

  public upsert(game: Game): void {
    const stmt = this.db.prepare(`
      INSERT INTO games (
        id, title, slug, description, cover_url, banner_url, platform,
        release_year, developer, publisher, state, size_bytes,
        installed_path, play_time_seconds, last_played_at, last_accessed_at,
        pinned, genres, rating, screenshot_urls, local_cover_path,
        local_banner_path, local_screenshot_paths, metadata_source,
        metadata_scraped_at, created_at, updated_at
      ) VALUES (
        @id, @title, @slug, @description, @coverUrl, @bannerUrl, @platform,
        @releaseYear, @developer, @publisher, @state, @sizeBytes,
        @installedPath, @playTimeSeconds, @lastPlayedAt, @lastAccessedAt,
        @pinned, @genres, @rating, @screenshotUrls, @localCoverPath,
        @localBannerPath, @localScreenshotPaths, @metadataSource,
        @metadataScrapedAt, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        slug = excluded.slug,
        description = COALESCE(excluded.description, games.description),
        cover_url = COALESCE(excluded.cover_url, games.cover_url),
        banner_url = COALESCE(excluded.banner_url, games.banner_url),
        platform = excluded.platform,
        release_year = COALESCE(excluded.release_year, games.release_year),
        developer = COALESCE(excluded.developer, games.developer),
        publisher = COALESCE(excluded.publisher, games.publisher),
        state = excluded.state,
        size_bytes = excluded.size_bytes,
        installed_path = excluded.installed_path,
        play_time_seconds = MAX(games.play_time_seconds, excluded.play_time_seconds),
        last_played_at = COALESCE(games.last_played_at, excluded.last_played_at),
        last_accessed_at = COALESCE(excluded.last_accessed_at, games.last_accessed_at),
        pinned = COALESCE(excluded.pinned, games.pinned),
        genres = COALESCE(excluded.genres, games.genres),
        rating = COALESCE(excluded.rating, games.rating),
        screenshot_urls = COALESCE(excluded.screenshot_urls, games.screenshot_urls),
        local_cover_path = COALESCE(excluded.local_cover_path, games.local_cover_path),
        local_banner_path = COALESCE(excluded.local_banner_path, games.local_banner_path),
        local_screenshot_paths = COALESCE(excluded.local_screenshot_paths, games.local_screenshot_paths),
        metadata_source = COALESCE(excluded.metadata_source, games.metadata_source),
        metadata_scraped_at = COALESCE(excluded.metadata_scraped_at, games.metadata_scraped_at),
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: game.id,
      title: game.title,
      slug: game.slug,
      description: game.description ?? null,
      coverUrl: game.coverUrl ?? null,
      bannerUrl: game.bannerUrl ?? null,
      platform: game.platform,
      releaseYear: game.releaseYear ?? null,
      developer: game.developer ?? null,
      publisher: game.publisher ?? null,
      state: game.state,
      sizeBytes: game.sizeBytes,
      installedPath: game.installedPath ?? null,
      playTimeSeconds: game.playTimeSeconds,
      lastPlayedAt: game.lastPlayedAt ?? null,
      lastAccessedAt: game.lastAccessedAt ?? null,
      pinned: game.pinned ? 1 : 0,
      genres: game.genres ? JSON.stringify(game.genres) : null,
      rating: game.rating ?? null,
      screenshotUrls: game.screenshotUrls ? JSON.stringify(game.screenshotUrls) : null,
      localCoverPath: game.localCoverPath ?? null,
      localBannerPath: game.localBannerPath ?? null,
      localScreenshotPaths: game.localScreenshotPaths ? JSON.stringify(game.localScreenshotPaths) : null,
      metadataSource: game.metadataSource ?? null,
      metadataScrapedAt: game.metadataScrapedAt ?? null,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt
    });
  }

  public updateState(id: string, state: GameState, installedPath?: string | null): void {
    if (installedPath !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE games 
        SET state = ?, installed_path = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(state, installedPath, new Date().toISOString(), id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE games 
        SET state = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(state, new Date().toISOString(), id);
    }
  }

  public updatePlayTime(id: string, playTimeSeconds: number, lastPlayedAt?: string): void {
    const stmt = this.db.prepare(`
      UPDATE games 
      SET play_time_seconds = ?, last_played_at = COALESCE(?, last_played_at), updated_at = ?
      WHERE id = ?
    `);
    stmt.run(playTimeSeconds, lastPlayedAt ?? null, new Date().toISOString(), id);
  }

  public recordSessionPlaytime(id: string, additionalSeconds: number, lastPlayedAt: string): void {
    const stmt = this.db.prepare(`
      UPDATE games
      SET play_time_seconds = play_time_seconds + @additionalSeconds,
          last_played_at = @lastPlayedAt,
          last_accessed_at = @lastPlayedAt,
          updated_at = @now
      WHERE id = @id
    `);
    stmt.run({
      id,
      additionalSeconds: Math.max(0, Math.round(additionalSeconds)),
      lastPlayedAt,
      now: new Date().toISOString()
    });
  }

  public setPinned(id: string, pinned: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE games
      SET pinned = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(pinned ? 1 : 0, new Date().toISOString(), id);
  }

  public updateLastAccessed(id: string, timestamp?: string): void {
    const stmt = this.db.prepare(`
      UPDATE games
      SET last_accessed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(timestamp || new Date().toISOString(), new Date().toISOString(), id);
  }

  public getEvictionCandidates(excludePinned = true): Game[] {
    const stmt = this.db.prepare(`
      SELECT * FROM games
      WHERE state = 'READY'
        AND (? = 0 OR pinned = 0)
      ORDER BY
        pinned ASC,
        COALESCE(last_played_at, last_accessed_at, '1970-01-01') ASC,
        size_bytes DESC
    `);
    const rows = stmt.all(excludePinned ? 1 : 0) as GameRow[];
    return rows.map(mapRowToGame);
  }

  public updateMetadata(
    id: string,
    metadata: {
      title?: string;
      description?: string;
      coverUrl?: string;
      bannerUrl?: string;
      releaseYear?: number;
      developer?: string;
      publisher?: string;
      genres?: string[];
      rating?: number;
      screenshotUrls?: string[];
      localCoverPath?: string;
      localBannerPath?: string;
      localScreenshotPaths?: string[];
      metadataSource?: string;
      metadataScrapedAt?: string;
    }
  ): void {
    const existing = this.getById(id);
    if (!existing) return;

    const stmt = this.db.prepare(`
      UPDATE games
      SET
        title = COALESCE(@title, title),
        description = COALESCE(@description, description),
        cover_url = COALESCE(@coverUrl, cover_url),
        banner_url = COALESCE(@bannerUrl, banner_url),
        release_year = COALESCE(@releaseYear, release_year),
        developer = COALESCE(@developer, developer),
        publisher = COALESCE(@publisher, publisher),
        genres = COALESCE(@genres, genres),
        rating = COALESCE(@rating, rating),
        screenshot_urls = COALESCE(@screenshotUrls, screenshot_urls),
        local_cover_path = COALESCE(@localCoverPath, local_cover_path),
        local_banner_path = COALESCE(@localBannerPath, local_banner_path),
        local_screenshot_paths = COALESCE(@localScreenshotPaths, local_screenshot_paths),
        metadata_source = COALESCE(@metadataSource, metadata_source),
        metadata_scraped_at = COALESCE(@metadataScrapedAt, metadata_scraped_at),
        updated_at = @updatedAt
      WHERE id = @id
    `);

    stmt.run({
      id,
      title: metadata.title ?? null,
      description: metadata.description ?? null,
      coverUrl: metadata.coverUrl ?? null,
      bannerUrl: metadata.bannerUrl ?? null,
      releaseYear: metadata.releaseYear ?? null,
      developer: metadata.developer ?? null,
      publisher: metadata.publisher ?? null,
      genres: metadata.genres ? JSON.stringify(metadata.genres) : null,
      rating: metadata.rating ?? null,
      screenshotUrls: metadata.screenshotUrls ? JSON.stringify(metadata.screenshotUrls) : null,
      localCoverPath: metadata.localCoverPath ?? null,
      localBannerPath: metadata.localBannerPath ?? null,
      localScreenshotPaths: metadata.localScreenshotPaths ? JSON.stringify(metadata.localScreenshotPaths) : null,
      metadataSource: metadata.metadataSource ?? null,
      metadataScrapedAt: metadata.metadataScrapedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  public getUnscrapedGames(limit?: number): Game[] {
    const sql = limit && limit > 0
      ? 'SELECT * FROM games WHERE metadata_scraped_at IS NULL ORDER BY title ASC LIMIT ?'
      : 'SELECT * FROM games WHERE metadata_scraped_at IS NULL ORDER BY title ASC';
    const stmt = this.db.prepare(sql);
    const rows = (limit && limit > 0 ? stmt.all(limit) : stmt.all()) as GameRow[];
    return rows.map(mapRowToGame);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM games WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

