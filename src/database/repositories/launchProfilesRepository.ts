import type { Database } from 'better-sqlite3';
import { LaunchProfile, LauncherType } from '../../core/types';

interface LaunchProfileRow {
  id: string;
  game_id: string;
  launcher_type: string;
  emulator_id: string | null;
  executable_path: string | null;
  arguments_template: string | null;
  working_directory: string | null;
  fullscreen: number;
  playback_mode?: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToLaunchProfile(row: LaunchProfileRow): LaunchProfile {
  return {
    id: row.id,
    gameId: row.game_id,
    launcherType: row.launcher_type as LauncherType,
    emulatorId: row.emulator_id ?? undefined,
    executablePath: row.executable_path ?? undefined,
    argumentsTemplate: row.arguments_template ?? undefined,
    workingDirectory: row.working_directory ?? undefined,
    fullscreen: Boolean(row.fullscreen),
    playbackMode: (row.playback_mode as any) || 'auto',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class LaunchProfilesRepository {
  constructor(private db: Database) {}

  public getByGameId(gameId: string): LaunchProfile | null {
    const stmt = this.db.prepare('SELECT * FROM launch_profiles WHERE game_id = ?');
    const row = stmt.get(gameId) as LaunchProfileRow | undefined;
    return row ? mapRowToLaunchProfile(row) : null;
  }

  public getById(id: string): LaunchProfile | null {
    const stmt = this.db.prepare('SELECT * FROM launch_profiles WHERE id = ?');
    const row = stmt.get(id) as LaunchProfileRow | undefined;
    return row ? mapRowToLaunchProfile(row) : null;
  }

  public getAll(): LaunchProfile[] {
    const stmt = this.db.prepare('SELECT * FROM launch_profiles ORDER BY created_at DESC');
    const rows = stmt.all() as LaunchProfileRow[];
    return rows.map(mapRowToLaunchProfile);
  }

  public upsert(profile: LaunchProfile): void {
    const stmt = this.db.prepare(`
      INSERT INTO launch_profiles (
        id, game_id, launcher_type, emulator_id, executable_path,
        arguments_template, working_directory, fullscreen, playback_mode, created_at, updated_at
      ) VALUES (
        @id, @gameId, @launcherType, @emulatorId, @executablePath,
        @argumentsTemplate, @workingDirectory, @fullscreen, @playbackMode, @createdAt, @updatedAt
      )
      ON CONFLICT(game_id) DO UPDATE SET
        launcher_type = excluded.launcher_type,
        emulator_id = excluded.emulator_id,
        executable_path = excluded.executable_path,
        arguments_template = excluded.arguments_template,
        working_directory = excluded.working_directory,
        fullscreen = excluded.fullscreen,
        playback_mode = excluded.playback_mode,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: profile.id,
      gameId: profile.gameId,
      launcherType: profile.launcherType,
      emulatorId: profile.emulatorId ?? null,
      executablePath: profile.executablePath ?? null,
      argumentsTemplate: profile.argumentsTemplate ?? null,
      workingDirectory: profile.workingDirectory ?? null,
      fullscreen: profile.fullscreen ? 1 : 0,
      playbackMode: profile.playbackMode || 'auto',
      createdAt: profile.createdAt || new Date().toISOString(),
      updatedAt: profile.updatedAt || new Date().toISOString()
    });
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM launch_profiles WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public deleteByGameId(gameId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM launch_profiles WHERE game_id = ?');
    const result = stmt.run(gameId);
    return result.changes > 0;
  }
}
