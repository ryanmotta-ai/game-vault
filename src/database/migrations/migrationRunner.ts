import type { Database } from 'better-sqlite3';
import { logger } from '../../core/logger';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export class MigrationRunner {
  private log = logger.child('Migrations');

  constructor(private db: Database) {}

  public initializeMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  public getAppliedVersions(): Set<number> {
    this.initializeMigrationsTable();
    const rows = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Array<{
      version: number;
    }>;
    return new Set(rows.map((r) => r.version));
  }

  public runMigrations(migrations: Migration[]): void {
    this.initializeMigrationsTable();
    const applied = this.getAppliedVersions();

    // Sort ascending by version
    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    for (const migration of sorted) {
      if (!applied.has(migration.version)) {
        this.log.info(`Applying migration [${migration.version}] ${migration.name}...`);
        
        const runTransaction = this.db.transaction(() => {
          migration.up(this.db);
          this.db.prepare(`
            INSERT INTO schema_migrations (version, name, applied_at)
            VALUES (?, ?, ?)
          `).run(migration.version, migration.name, new Date().toISOString());
        });

        runTransaction();
        this.log.info(`Successfully applied migration [${migration.version}] ${migration.name}.`);
      } else {
        this.log.debug(`Migration [${migration.version}] ${migration.name} is already applied.`);
      }
    }
  }
}
