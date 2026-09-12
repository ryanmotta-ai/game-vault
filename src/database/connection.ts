import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../core/logger';
import { configManager } from '../core/config';
import { DatabaseError } from '../core/errors/AppError';

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private db: Database.Database | null = null;
  private log = logger.child('Database');

  private constructor() {}

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public getDatabase(customPath?: string): Database.Database {
    if (this.db) {
      return this.db;
    }

    try {
      const dbPath = customPath || configManager.get('databasePath');

      if (dbPath !== ':memory:') {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this.log.info(`Connecting to SQLite database at: ${dbPath}`);
      this.db = new Database(dbPath);

      // Performance and integrity pragmas
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');

      this.log.info('SQLite database connected successfully (WAL mode enabled, Foreign Keys ON).');
      return this.db;
    } catch (err) {
      this.log.error('Failed to initialize SQLite database:', err);
      throw new DatabaseError('Failed to initialize SQLite database', err);
    }
  }

  public close(): void {
    if (this.db) {
      this.log.info('Closing SQLite database connection.');
      this.db.close();
      this.db = null;
    }
  }
}

export const getDb = (customPath?: string) => DatabaseConnection.getInstance().getDatabase(customPath);
