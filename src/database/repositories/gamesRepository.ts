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
  created_at: string;
  updated_at: string;
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
        installed_path, play_time_seconds, last_played_at, created_at, updated_at
      ) VALUES (
        @id, @title, @slug, @description, @coverUrl, @bannerUrl, @platform,
        @releaseYear, @developer, @publisher, @state, @sizeBytes,
        @installedPath, @playTimeSeconds, @lastPlayedAt, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        slug = excluded.slug,
        description = excluded.description,
        cover_url = excluded.cover_url,
        banner_url = excluded.banner_url,
        platform = excluded.platform,
        release_year = excluded.release_year,
        developer = excluded.developer,
        publisher = excluded.publisher,
        state = excluded.state,
        size_bytes = excluded.size_bytes,
        installed_path = excluded.installed_path,
        play_time_seconds = excluded.play_time_seconds,
        last_played_at = excluded.last_played_at,
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
      createdAt: game.createdAt,
      updatedAt: game.updatedAt
    });
  }

  public updateState(id: string, state: GameState, installedPath?: string): void {
    const stmt = this.db.prepare(`
      UPDATE games 
      SET state = ?, installed_path = COALESCE(?, installed_path), updated_at = ?
      WHERE id = ?
    `);
    stmt.run(state, installedPath ?? null, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM games WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
