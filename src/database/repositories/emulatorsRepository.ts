import type { Database } from 'better-sqlite3';
import { Emulator, GamePlatform } from '../../core/types';

interface EmulatorRow {
  id: string;
  name: string;
  platform: string;
  executable_path: string;
  default_args: string | null;
  config_path: string | null;
  is_installed: number;
  version: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToEmulator(row: EmulatorRow): Emulator {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform as GamePlatform,
    executablePath: row.executable_path,
    defaultArgs: row.default_args ?? undefined,
    configPath: row.config_path ?? undefined,
    isInstalled: Boolean(row.is_installed),
    version: row.version ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class EmulatorsRepository {
  constructor(private db: Database) {}

  public getAll(): Emulator[] {
    const stmt = this.db.prepare('SELECT * FROM emulators ORDER BY name ASC');
    const rows = stmt.all() as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public getByPlatform(platform: GamePlatform): Emulator[] {
    const stmt = this.db.prepare('SELECT * FROM emulators WHERE platform = ?');
    const rows = stmt.all(platform) as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public upsert(emulator: Emulator): void {
    const stmt = this.db.prepare(`
      INSERT INTO emulators (
        id, name, platform, executable_path, default_args,
        config_path, is_installed, version, created_at, updated_at
      ) VALUES (
        @id, @name, @platform, @executablePath, @defaultArgs,
        @configPath, @isInstalled, @version, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        platform = excluded.platform,
        executable_path = excluded.executable_path,
        default_args = excluded.default_args,
        config_path = excluded.config_path,
        is_installed = excluded.is_installed,
        version = excluded.version,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: emulator.id,
      name: emulator.name,
      platform: emulator.platform,
      executablePath: emulator.executablePath,
      defaultArgs: emulator.defaultArgs ?? null,
      configPath: emulator.configPath ?? null,
      isInstalled: emulator.isInstalled ? 1 : 0,
      version: emulator.version ?? null,
      createdAt: emulator.createdAt,
      updatedAt: emulator.updatedAt
    });
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM emulators WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
