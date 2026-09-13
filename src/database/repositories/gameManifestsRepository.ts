import type { Database } from 'better-sqlite3';
import { GameManifest, GamePlatform } from '../../core/types';

interface GameManifestRow {
  game_id: string;
  title: string;
  platform: string;
  prepared_at: string;
  primary_executable_or_rom: string;
  total_local_size: number;
  install_required: number;
  files_json: string;
  source_artifact_ids_json: string | null;
  integrity_status: string;
  created_at: string;
  updated_at: string;
}

function mapRowToManifest(row: GameManifestRow): GameManifest {
  return {
    gameId: row.game_id,
    title: row.title,
    platform: row.platform as GamePlatform,
    preparedAt: row.prepared_at,
    primaryExecutableOrRom: row.primary_executable_or_rom,
    totalLocalSize: row.total_local_size,
    installRequired: row.install_required === 1,
    files: JSON.parse(row.files_json),
    sourceArtifactIds: row.source_artifact_ids_json ? JSON.parse(row.source_artifact_ids_json) : undefined,
    integrityStatus: row.integrity_status as 'VERIFIED' | 'UNVERIFIED' | 'CORRUPTED'
  };
}

export class GameManifestsRepository {
  constructor(private db: Database) {}

  public getByGameId(gameId: string): GameManifest | null {
    const stmt = this.db.prepare('SELECT * FROM game_manifests WHERE game_id = ?');
    const row = stmt.get(gameId) as GameManifestRow | undefined;
    return row ? mapRowToManifest(row) : null;
  }

  public get(gameId: string): GameManifest | null {
    return this.getByGameId(gameId);
  }

  public getAll(): GameManifest[] {
    const stmt = this.db.prepare('SELECT * FROM game_manifests ORDER BY prepared_at DESC');
    const rows = stmt.all() as GameManifestRow[];
    return rows.map(mapRowToManifest);
  }

  public upsert(manifest: GameManifest): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO game_manifests (
        game_id, title, platform, prepared_at,
        primary_executable_or_rom, total_local_size, install_required,
        files_json, source_artifact_ids_json, integrity_status,
        created_at, updated_at
      ) VALUES (
        @gameId, @title, @platform, @preparedAt,
        @primaryExecutableOrRom, @totalLocalSize, @installRequired,
        @filesJson, @sourceArtifactIdsJson, @integrityStatus,
        @createdAt, @updatedAt
      )
      ON CONFLICT(game_id) DO UPDATE SET
        title = excluded.title,
        platform = excluded.platform,
        prepared_at = excluded.prepared_at,
        primary_executable_or_rom = excluded.primary_executable_or_rom,
        total_local_size = excluded.total_local_size,
        install_required = excluded.install_required,
        files_json = excluded.files_json,
        source_artifact_ids_json = excluded.source_artifact_ids_json,
        integrity_status = excluded.integrity_status,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      gameId: manifest.gameId,
      title: manifest.title,
      platform: manifest.platform,
      preparedAt: manifest.preparedAt,
      primaryExecutableOrRom: manifest.primaryExecutableOrRom,
      totalLocalSize: manifest.totalLocalSize,
      installRequired: manifest.installRequired ? 1 : 0,
      filesJson: JSON.stringify(manifest.files),
      sourceArtifactIdsJson: manifest.sourceArtifactIds ? JSON.stringify(manifest.sourceArtifactIds) : null,
      integrityStatus: manifest.integrityStatus,
      createdAt: now,
      updatedAt: now
    });
  }

  public deleteByGameId(gameId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM game_manifests WHERE game_id = ?');
    const res = stmt.run(gameId);
    return res.changes > 0;
  }
}
