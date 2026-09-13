import { Database } from 'better-sqlite3';

export type MetadataJobStatus =
  | 'QUEUED'
  | 'SEARCHING'
  | 'MATCHED'
  | 'DOWNLOADING_MEDIA'
  | 'COMPLETED'
  | 'REVIEW_REQUIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED';

export type MetadataJobPriority = 'USER_REQUESTED' | 'NORMAL' | 'BACKGROUND';

export interface MetadataJobRecord {
  id: string;
  gameId: string;
  status: MetadataJobStatus;
  providerId?: string;
  confidence?: string;
  priority: MetadataJobPriority;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class MetadataJobsRepository {
  constructor(private db: Database) {}

  public getById(id: string): MetadataJobRecord | null {
    const row = this.db.prepare('SELECT * FROM metadata_jobs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getByGameId(gameId: string): MetadataJobRecord | null {
    const row = this.db
      .prepare('SELECT * FROM metadata_jobs WHERE game_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(gameId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getActiveJobs(): MetadataJobRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM metadata_jobs
        WHERE status IN ('QUEUED', 'SEARCHING', 'MATCHED', 'DOWNLOADING_MEDIA')
        ORDER BY
          CASE priority
            WHEN 'USER_REQUESTED' THEN 1
            WHEN 'NORMAL' THEN 2
            WHEN 'BACKGROUND' THEN 3
            ELSE 4
          END ASC,
          created_at ASC
      `)
      .all() as any[];

    return rows.map((r) => this.mapRow(r));
  }

  public getNextQueuedJob(): MetadataJobRecord | null {
    const row = this.db
      .prepare(`
        SELECT * FROM metadata_jobs
        WHERE status = 'QUEUED'
        ORDER BY
          CASE priority
            WHEN 'USER_REQUESTED' THEN 1
            WHEN 'NORMAL' THEN 2
            WHEN 'BACKGROUND' THEN 3
            ELSE 4
          END ASC,
          created_at ASC
        LIMIT 1
      `)
      .get() as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public upsert(record: MetadataJobRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO metadata_jobs (
          id, game_id, status, provider_id, confidence,
          priority, error_message, started_at, finished_at,
          created_at, updated_at
        ) VALUES (
          @id, @gameId, @status, @providerId, @confidence,
          @priority, @errorMessage, @startedAt, @finishedAt,
          @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          provider_id = COALESCE(excluded.provider_id, provider_id),
          confidence = COALESCE(excluded.confidence, confidence),
          priority = excluded.priority,
          error_message = COALESCE(excluded.error_message, error_message),
          started_at = COALESCE(excluded.started_at, started_at),
          finished_at = COALESCE(excluded.finished_at, finished_at),
          updated_at = excluded.updated_at
      `)
      .run({
        id: record.id,
        gameId: record.gameId,
        status: record.status,
        providerId: record.providerId ?? null,
        confidence: record.confidence ?? null,
        priority: record.priority,
        errorMessage: record.errorMessage ?? null,
        startedAt: record.startedAt ?? null,
        finishedAt: record.finishedAt ?? null,
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now
      });
  }

  public updateStatus(id: string, status: MetadataJobStatus, errorMessage?: string): void {
    const now = new Date().toISOString();
    const isFinished = ['COMPLETED', 'REVIEW_REQUIRED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(status);
    const isStarting = ['SEARCHING', 'DOWNLOADING_MEDIA'].includes(status);

    this.db
      .prepare(`
        UPDATE metadata_jobs
        SET
          status = ?,
          error_message = COALESCE(?, error_message),
          started_at = CASE WHEN ? = 1 AND started_at IS NULL THEN ? ELSE started_at END,
          finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        status,
        errorMessage ?? null,
        isStarting ? 1 : 0,
        now,
        isFinished ? 1 : 0,
        now,
        now,
        id
      );
  }

  public recoverStaleJobs(): number {
    const now = new Date().toISOString();
    // Stale jobs are those interrupted mid-execution (SEARCHING or DOWNLOADING_MEDIA)
    const result = this.db
      .prepare(`
        UPDATE metadata_jobs
        SET status = 'QUEUED', updated_at = ?
        WHERE status IN ('SEARCHING', 'DOWNLOADING_MEDIA')
      `)
      .run(now);

    return result.changes;
  }

  public delete(id: string): void {
    this.db.prepare('DELETE FROM metadata_jobs WHERE id = ?').run(id);
  }

  private mapRow(row: any): MetadataJobRecord {
    return {
      id: row.id,
      gameId: row.game_id,
      status: row.status,
      providerId: row.provider_id || undefined,
      confidence: row.confidence || undefined,
      priority: row.priority,
      errorMessage: row.error_message || undefined,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
