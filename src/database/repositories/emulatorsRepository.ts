import type { Database } from 'better-sqlite3';
import { Emulator, EmulatorAdapterType, GamePlatform } from '../../core/types';

interface EmulatorRow {
  id: string;
  name: string;
  adapter_type?: string | null;
  executable_path: string;
  supported_platforms_json?: string | null;
  default_args?: string | null;
  fullscreen_args?: string | null;
  working_directory?: string | null;
  is_installed?: number;
  detected?: number;
  enabled?: number;
  version?: string | null;
  created_at: string;
  updated_at: string;
  // legacy
  platform?: string | null;
  config_path?: string | null;
}

function mapRowToEmulator(row: EmulatorRow): Emulator {
  let platforms: GamePlatform[] = [];
  if (row.supported_platforms_json) {
    try {
      platforms = JSON.parse(row.supported_platforms_json);
    } catch {
      platforms = [];
    }
  }
  if (platforms.length === 0 && row.platform) {
    platforms = [row.platform as GamePlatform];
  }

  const isDetected = Boolean(row.detected ?? row.is_installed ?? 0);
  const isEnabled = Boolean(row.enabled ?? 1);

  return {
    id: row.id,
    name: row.name,
    adapterType: (row.adapter_type as EmulatorAdapterType) || 'custom',
    executablePath: row.executable_path,
    supportedPlatforms: platforms,
    defaultArgs: row.default_args ?? undefined,
    fullscreenArgs: row.fullscreen_args ?? undefined,
    workingDirectory: row.working_directory ?? undefined,
    version: row.version ?? undefined,
    detected: isDetected,
    enabled: isEnabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Legacy fields
    platform: (row.platform as GamePlatform) || platforms[0],
    isInstalled: isDetected,
    configPath: row.config_path ?? undefined
  };
}

export class EmulatorsRepository {
  constructor(private db: Database) {}

  public getAll(): Emulator[] {
    const stmt = this.db.prepare('SELECT * FROM emulators ORDER BY name ASC');
    const rows = stmt.all() as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public getById(id: string): Emulator | null {
    const stmt = this.db.prepare('SELECT * FROM emulators WHERE id = ?');
    const row = stmt.get(id) as EmulatorRow | undefined;
    return row ? mapRowToEmulator(row) : null;
  }

  public getByAdapterType(adapterType: EmulatorAdapterType): Emulator | null {
    const stmt = this.db.prepare('SELECT * FROM emulators WHERE adapter_type = ? LIMIT 1');
    const row = stmt.get(adapterType) as EmulatorRow | undefined;
    return row ? mapRowToEmulator(row) : null;
  }

  public getByPlatform(platform: GamePlatform): Emulator[] {
    // Check both exact platform column (legacy) and supported_platforms_json containing platform
    const stmt = this.db.prepare(`
      SELECT * FROM emulators 
      WHERE platform = ? 
         OR supported_platforms_json LIKE ?
      ORDER BY enabled DESC, detected DESC, name ASC
    `);
    const pattern = `%"${platform}"%`;
    const rows = stmt.all(platform, pattern) as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public getEnabled(): Emulator[] {
    const stmt = this.db.prepare('SELECT * FROM emulators WHERE enabled = 1 ORDER BY name ASC');
    const rows = stmt.all() as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public getDetected(): Emulator[] {
    const stmt = this.db.prepare('SELECT * FROM emulators WHERE detected = 1 ORDER BY name ASC');
    const rows = stmt.all() as EmulatorRow[];
    return rows.map(mapRowToEmulator);
  }

  public upsert(emulator: Emulator): void {
    const platformsJson = JSON.stringify(emulator.supportedPlatforms || (emulator.platform ? [emulator.platform] : []));
    const primaryPlatform = emulator.platform || emulator.supportedPlatforms?.[0] || 'Unknown';

    const stmt = this.db.prepare(`
      INSERT INTO emulators (
        id, name, adapter_type, executable_path, supported_platforms_json,
        default_args, fullscreen_args, working_directory, is_installed, detected,
        enabled, version, created_at, updated_at, platform, config_path
      ) VALUES (
        @id, @name, @adapterType, @executablePath, @supportedPlatformsJson,
        @defaultArgs, @fullscreenArgs, @workingDirectory, @isInstalled, @detected,
        @enabled, @version, @createdAt, @updatedAt, @platform, @configPath
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        adapter_type = excluded.adapter_type,
        executable_path = excluded.executable_path,
        supported_platforms_json = excluded.supported_platforms_json,
        default_args = excluded.default_args,
        fullscreen_args = excluded.fullscreen_args,
        working_directory = excluded.working_directory,
        is_installed = excluded.is_installed,
        detected = excluded.detected,
        enabled = excluded.enabled,
        version = excluded.version,
        updated_at = excluded.updated_at,
        platform = excluded.platform,
        config_path = excluded.config_path
    `);

    stmt.run({
      id: emulator.id,
      name: emulator.name,
      adapterType: emulator.adapterType || 'custom',
      executablePath: emulator.executablePath,
      supportedPlatformsJson: platformsJson,
      defaultArgs: emulator.defaultArgs ?? null,
      fullscreenArgs: emulator.fullscreenArgs ?? null,
      workingDirectory: emulator.workingDirectory ?? null,
      isInstalled: emulator.detected || emulator.isInstalled ? 1 : 0,
      detected: emulator.detected ? 1 : 0,
      enabled: emulator.enabled !== false ? 1 : 0,
      version: emulator.version ?? null,
      createdAt: emulator.createdAt || new Date().toISOString(),
      updatedAt: emulator.updatedAt || new Date().toISOString(),
      platform: primaryPlatform,
      configPath: emulator.configPath ?? null
    });
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM emulators WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
