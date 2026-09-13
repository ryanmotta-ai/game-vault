import { Database } from 'better-sqlite3';

export type GameArtworkType =
  | 'COVER_FRONT'
  | 'COVER_BACK'
  | 'BOX_3D'
  | 'LOGO'
  | 'BACKGROUND'
  | 'SCREENSHOT'
  | 'TITLE_SCREEN'
  | 'FANART'
  | 'ICON'
  | 'VIDEO'
  | 'MANUAL';

export interface GameArtworkRecord {
  id: string;
  gameId: string;
  type: GameArtworkType;
  provider: string;
  providerMediaId?: string;
  sourceUrl?: string;
  localPath: string;
  width?: number;
  height?: number;
  mimeType?: string;
  fileSize?: number;
  checksum?: string;
  isPrimary?: boolean;
  isUserCustom?: boolean;
  status: 'CACHED' | 'MISSING' | 'PENDING';
  createdAt: string;
  updatedAt: string;
}

export class GameArtworkRepository {
  constructor(private db: Database) {}

  public getById(id: string): GameArtworkRecord | null {
    const row = this.db.prepare('SELECT * FROM game_artwork WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getByGameId(gameId: string): GameArtworkRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM game_artwork WHERE game_id = ? ORDER BY is_primary DESC, created_at ASC')
      .all(gameId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  public getPrimaryArtwork(gameId: string, type: GameArtworkType): GameArtworkRecord | null {
    const row = this.db
      .prepare('SELECT * FROM game_artwork WHERE game_id = ? AND type = ? AND is_primary = 1 LIMIT 1')
      .get(gameId, type) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public getArtworkByType(gameId: string, type: GameArtworkType): GameArtworkRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM game_artwork WHERE game_id = ? AND type = ? ORDER BY is_primary DESC, created_at ASC')
      .all(gameId, type) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  public upsert(record: GameArtworkRecord): void {
    const now = new Date().toISOString();

    // If marked as primary, reset other artworks of same game and type first
    if (record.isPrimary) {
      this.db
        .prepare('UPDATE game_artwork SET is_primary = 0 WHERE game_id = ? AND type = ?')
        .run(record.gameId, record.type);
    }

    this.db
      .prepare(`
        INSERT INTO game_artwork (
          id, game_id, type, provider, provider_media_id, source_url,
          local_path, width, height, mime_type, file_size, checksum,
          is_primary, is_user_custom, status, created_at, updated_at
        ) VALUES (
          @id, @gameId, @type, @provider, @providerMediaId, @sourceUrl,
          @localPath, @width, @height, @mimeType, @fileSize, @checksum,
          @isPrimary, @isUserCustom, @status, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          provider_media_id = COALESCE(excluded.provider_media_id, provider_media_id),
          source_url = COALESCE(excluded.source_url, source_url),
          local_path = excluded.local_path,
          width = COALESCE(excluded.width, width),
          height = COALESCE(excluded.height, height),
          mime_type = COALESCE(excluded.mime_type, mime_type),
          file_size = COALESCE(excluded.file_size, file_size),
          checksum = COALESCE(excluded.checksum, checksum),
          is_primary = excluded.is_primary,
          is_user_custom = excluded.is_user_custom,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run({
        id: record.id,
        gameId: record.gameId,
        type: record.type,
        provider: record.provider,
        providerMediaId: record.providerMediaId ?? null,
        sourceUrl: record.sourceUrl ?? null,
        localPath: record.localPath,
        width: record.width ?? null,
        height: record.height ?? null,
        mimeType: record.mimeType ?? null,
        fileSize: record.fileSize ?? null,
        checksum: record.checksum ?? null,
        isPrimary: record.isPrimary ? 1 : 0,
        isUserCustom: record.isUserCustom ? 1 : 0,
        status: record.status,
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now
      });
  }

  public setPrimary(id: string): void {
    const artwork = this.getById(id);
    if (!artwork) return;

    this.db
      .prepare('UPDATE game_artwork SET is_primary = 0 WHERE game_id = ? AND type = ?')
      .run(artwork.gameId, artwork.type);

    this.db
      .prepare('UPDATE game_artwork SET is_primary = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  public delete(id: string): void {
    this.db.prepare('DELETE FROM game_artwork WHERE id = ?').run(id);
  }

  public deleteByGameId(gameId: string): void {
    this.db.prepare('DELETE FROM game_artwork WHERE game_id = ?').run(gameId);
  }

  private mapRow(row: any): GameArtworkRecord {
    return {
      id: row.id,
      gameId: row.game_id,
      type: row.type,
      provider: row.provider,
      providerMediaId: row.provider_media_id || undefined,
      sourceUrl: row.source_url || undefined,
      localPath: row.local_path,
      width: row.width !== null ? Number(row.width) : undefined,
      height: row.height !== null ? Number(row.height) : undefined,
      mimeType: row.mime_type || undefined,
      fileSize: row.file_size !== null ? Number(row.file_size) : undefined,
      checksum: row.checksum || undefined,
      isPrimary: Boolean(row.is_primary),
      isUserCustom: Boolean(row.is_user_custom),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
