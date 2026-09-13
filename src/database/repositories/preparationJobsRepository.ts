import type { Database } from 'better-sqlite3';
import { PreparationJob, PreparationJobStatus } from '../../core/types';

interface PreparationJobRow {
  id: string;
  game_id: string;
  status: string;
  step: string | null;
  progress_percentage: number;
  total_bytes: number;
  processed_bytes: number;
  temp_dir: string | null;
  destination_dir: string | null;
  primary_file_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapRowToJob(row: PreparationJobRow): PreparationJob {
  return {
    id: row.id,
    gameId: row.game_id,
    status: row.status as PreparationJobStatus,
    step: row.step ?? undefined,
    progressPercentage: row.progress_percentage,
    totalBytes: row.total_bytes,
    processedBytes: row.processed_bytes,
    tempDir: row.temp_dir ?? undefined,
    destinationDir: row.destination_dir ?? undefined,
    primaryFilePath: row.primary_file_path ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

export class PreparationJobsRepository {
  constructor(private db: Database) {}

  public getById(id: string): PreparationJob | null {
    const stmt = this.db.prepare('SELECT * FROM preparation_jobs WHERE id = ?');
    const row = stmt.get(id) as PreparationJobRow | undefined;
    return row ? mapRowToJob(row) : null;
  }

  public getByGameId(gameId: string): PreparationJob | null {
    const stmt = this.db.prepare(`
      SELECT * FROM preparation_jobs
      WHERE game_id = ?
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = stmt.get(gameId) as PreparationJobRow | undefined;
    return row ? mapRowToJob(row) : null;
  }

  public getActive(): PreparationJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM preparation_jobs
      WHERE status IN ('QUEUED', 'EXTRACTING', 'VALIDATING', 'FINALIZING')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as PreparationJobRow[];
    return rows.map(mapRowToJob);
  }

  public getActiveByGameId(gameId: string): PreparationJob | null {
    const stmt = this.db.prepare(`
      SELECT * FROM preparation_jobs
      WHERE game_id = ? AND status IN ('QUEUED', 'EXTRACTING', 'VALIDATING', 'FINALIZING')
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = stmt.get(gameId) as PreparationJobRow | undefined;
    return row ? mapRowToJob(row) : null;
  }

  public getStaleJobs(): PreparationJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM preparation_jobs
      WHERE status IN ('QUEUED', 'EXTRACTING', 'VALIDATING', 'FINALIZING')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as PreparationJobRow[];
    return rows.map(mapRowToJob);
  }

  public getAll(): PreparationJob[] {
    const stmt = this.db.prepare('SELECT * FROM preparation_jobs ORDER BY created_at DESC');
    const rows = stmt.all() as PreparationJobRow[];
    return rows.map(mapRowToJob);
  }

  public create(job: PreparationJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO preparation_jobs (
        id, game_id, status, step, progress_percentage,
        total_bytes, processed_bytes, temp_dir, destination_dir,
        primary_file_path, error_message, created_at, updated_at, completed_at
      ) VALUES (
        @id, @gameId, @status, @step, @progressPercentage,
        @totalBytes, @processedBytes, @tempDir, @destinationDir,
        @primaryFilePath, @errorMessage, @createdAt, @updatedAt, @completedAt
      )
    `);

    stmt.run({
      id: job.id,
      gameId: job.gameId,
      status: job.status,
      step: job.step ?? null,
      progressPercentage: job.progressPercentage,
      totalBytes: job.totalBytes,
      processedBytes: job.processedBytes,
      tempDir: job.tempDir ?? null,
      destinationDir: job.destinationDir ?? null,
      primaryFilePath: job.primaryFilePath ?? null,
      errorMessage: job.errorMessage ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt ?? null
    });
  }

  public updateProgress(
    id: string,
    status: PreparationJobStatus,
    step: string | undefined,
    percentage: number,
    processedBytes: number,
    totalBytes?: number
  ): void {
    const now = new Date().toISOString();
    if (totalBytes !== undefined && totalBytes > 0) {
      const stmt = this.db.prepare(`
        UPDATE preparation_jobs
        SET status = ?, step = COALESCE(?, step), progress_percentage = ?,
            processed_bytes = ?, total_bytes = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, step ?? null, percentage, processedBytes, totalBytes, now, id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE preparation_jobs
        SET status = ?, step = COALESCE(?, step), progress_percentage = ?,
            processed_bytes = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, step ?? null, percentage, processedBytes, now, id);
    }
  }

  public complete(id: string, primaryFilePath?: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE preparation_jobs
      SET status = 'COMPLETED', step = 'Completed', progress_percentage = 100.0,
          primary_file_path = COALESCE(?, primary_file_path),
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(primaryFilePath ?? null, now, now, id);
  }

  public fail(id: string, errorMessage: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE preparation_jobs
      SET status = 'FAILED', step = 'Failed', error_message = ?,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage, now, now, id);
  }

  public cancel(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE preparation_jobs
      SET status = 'CANCELLED', step = 'Cancelled',
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, now, id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM preparation_jobs WHERE id = ?');
    const res = stmt.run(id);
    return res.changes > 0;
  }
}
