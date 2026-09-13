import type { Database } from 'better-sqlite3';
import { GameSession, LauncherType } from '../../core/types';

interface GameSessionRow {
  id: string;
  game_id: string;
  launcher_type: string;
  emulator_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  exit_code: number | null;
  crashed: number;
  created_at: string;
}

function mapRowToGameSession(row: GameSessionRow): GameSession {
  return {
    id: row.id,
    gameId: row.game_id,
    launcherType: row.launcher_type as LauncherType,
    emulatorId: row.emulator_id ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    durationSeconds: row.duration_seconds,
    exitCode: row.exit_code ?? undefined,
    crashed: Boolean(row.crashed),
    createdAt: row.created_at
  };
}

export class GameSessionsRepository {
  constructor(private db: Database) {}

  public create(session: GameSession): void {
    const stmt = this.db.prepare(`
      INSERT INTO game_sessions (
        id, game_id, launcher_type, emulator_id, started_at,
        ended_at, duration_seconds, exit_code, crashed, created_at
      ) VALUES (
        @id, @gameId, @launcherType, @emulatorId, @startedAt,
        @endedAt, @durationSeconds, @exitCode, @crashed, @createdAt
      )
    `);

    stmt.run({
      id: session.id,
      gameId: session.gameId,
      launcherType: session.launcherType,
      emulatorId: session.emulatorId ?? null,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      durationSeconds: session.durationSeconds ?? 0,
      exitCode: session.exitCode ?? null,
      crashed: session.crashed ? 1 : 0,
      createdAt: session.createdAt || session.startedAt
    });
  }

  public complete(
    id: string,
    updates: {
      endedAt: string;
      durationSeconds: number;
      exitCode?: number | null;
      crashed?: boolean;
    }
  ): void {
    const stmt = this.db.prepare(`
      UPDATE game_sessions
      SET ended_at = @endedAt,
          duration_seconds = @durationSeconds,
          exit_code = @exitCode,
          crashed = @crashed
      WHERE id = @id
    `);

    stmt.run({
      id,
      endedAt: updates.endedAt,
      durationSeconds: updates.durationSeconds,
      exitCode: updates.exitCode ?? null,
      crashed: updates.crashed ? 1 : 0
    });
  }

  public getById(id: string): GameSession | null {
    const stmt = this.db.prepare('SELECT * FROM game_sessions WHERE id = ?');
    const row = stmt.get(id) as GameSessionRow | undefined;
    return row ? mapRowToGameSession(row) : null;
  }

  public getByGameId(gameId: string): GameSession[] {
    const stmt = this.db.prepare('SELECT * FROM game_sessions WHERE game_id = ? ORDER BY started_at DESC');
    const rows = stmt.all(gameId) as GameSessionRow[];
    return rows.map(mapRowToGameSession);
  }

  public getActiveByGameId(gameId: string): GameSession | null {
    const stmt = this.db.prepare('SELECT * FROM game_sessions WHERE game_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1');
    const row = stmt.get(gameId) as GameSessionRow | undefined;
    return row ? mapRowToGameSession(row) : null;
  }

  public getAllActive(): GameSession[] {
    const stmt = this.db.prepare('SELECT * FROM game_sessions WHERE ended_at IS NULL ORDER BY started_at DESC');
    const rows = stmt.all() as GameSessionRow[];
    return rows.map(mapRowToGameSession);
  }

  public getAll(): GameSession[] {
    const stmt = this.db.prepare('SELECT * FROM game_sessions ORDER BY started_at DESC');
    const rows = stmt.all() as GameSessionRow[];
    return rows.map(mapRowToGameSession);
  }

  public getTotalPlaytimeSeconds(gameId: string): number {
    const stmt = this.db.prepare('SELECT SUM(duration_seconds) as total FROM game_sessions WHERE game_id = ?');
    const result = stmt.get(gameId) as { total: number | null } | undefined;
    return result?.total ?? 0;
  }
}
