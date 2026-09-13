import { Database } from 'better-sqlite3';

export type MatchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';
export type MetadataSourceStatus = 'MATCHED' | 'REVIEW_REQUIRED' | 'SKIPPED' | 'REJECTED' | 'USER_CONFIRMED';

export interface GameMetadataSourceRecord {
  id: string;
  gameId: string;
  providerId: string;
  providerGameId: string;
  connectionId?: string;
  confidence: MatchConfidence;
  matchSignalsJson?: string;
  matchedAt: string;
  lastSyncedAt?: string;
  sourceDataHash?: string;
  status: MetadataSourceStatus;
  createdAt: string;
  updatedAt: string;
}

export class GameMetadataSourcesRepository {
  constructor(private db: Database) {}

  public getById(id: string): GameMetadataSourceRecord | null {
    const row = this.db
      .prepare('SELECT * FROM game_metadata_sources WHERE id = ?')
      .get(id) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public getByGameAndProvider(gameId: string, providerId: string): GameMetadataSourceRecord | null {
    const row = this.db
      .prepare('SELECT * FROM game_metadata_sources WHERE game_id = ? AND provider_id = ?')
      .get(gameId, providerId) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public getByGameId(gameId: string): GameMetadataSourceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM game_metadata_sources WHERE game_id = ? ORDER BY matched_at DESC')
      .all(gameId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  public getReviewQueue(limit = 100): GameMetadataSourceRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM game_metadata_sources
        WHERE status = 'REVIEW_REQUIRED'
        ORDER BY matched_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  public upsert(record: GameMetadataSourceRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO game_metadata_sources (
          id, game_id, provider_id, provider_game_id, connection_id,
          confidence, match_signals_json, matched_at, last_synced_at,
          source_data_hash, status, created_at, updated_at
        ) VALUES (
          @id, @gameId, @providerId, @providerGameId, @connectionId,
          @confidence, @matchSignalsJson, @matchedAt, @lastSyncedAt,
          @sourceDataHash, @status, @createdAt, @updatedAt
        )
        ON CONFLICT(game_id, provider_id) DO UPDATE SET
          provider_game_id = excluded.provider_game_id,
          connection_id = COALESCE(excluded.connection_id, connection_id),
          confidence = excluded.confidence,
          match_signals_json = COALESCE(excluded.match_signals_json, match_signals_json),
          matched_at = excluded.matched_at,
          last_synced_at = COALESCE(excluded.last_synced_at, last_synced_at),
          source_data_hash = COALESCE(excluded.source_data_hash, source_data_hash),
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run({
        id: record.id,
        gameId: record.gameId,
        providerId: record.providerId,
        providerGameId: record.providerGameId,
        connectionId: record.connectionId ?? null,
        confidence: record.confidence,
        matchSignalsJson: record.matchSignalsJson ?? null,
        matchedAt: record.matchedAt || now,
        lastSyncedAt: record.lastSyncedAt ?? null,
        sourceDataHash: record.sourceDataHash ?? null,
        status: record.status,
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now
      });
  }

  public updateStatus(gameId: string, providerId: string, status: MetadataSourceStatus): void {
    this.db
      .prepare(`
        UPDATE game_metadata_sources
        SET status = ?, updated_at = ?
        WHERE game_id = ? AND provider_id = ?
      `)
      .run(status, new Date().toISOString(), gameId, providerId);
  }

  public updateStatusById(id: string, status: MetadataSourceStatus): void {
    this.db
      .prepare(`
        UPDATE game_metadata_sources
        SET status = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, new Date().toISOString(), id);
  }

  public isSkipped(gameId: string): boolean {
    const row = this.db
      .prepare(`
        SELECT 1 FROM game_metadata_sources
        WHERE game_id = ? AND status = 'SKIPPED'
        LIMIT 1
      `)
      .get(gameId);

    return !!row;
  }

  public delete(id: string): void {
    this.db.prepare('DELETE FROM game_metadata_sources WHERE id = ?').run(id);
  }

  public deleteByGameId(gameId: string): void {
    this.db.prepare('DELETE FROM game_metadata_sources WHERE game_id = ?').run(gameId);
  }

  private mapRow(row: any): GameMetadataSourceRecord {
    return {
      id: row.id,
      gameId: row.game_id,
      providerId: row.provider_id,
      providerGameId: row.provider_game_id,
      connectionId: row.connection_id || undefined,
      confidence: row.confidence,
      matchSignalsJson: row.match_signals_json || undefined,
      matchedAt: row.matched_at,
      lastSyncedAt: row.last_synced_at || undefined,
      sourceDataHash: row.source_data_hash || undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
