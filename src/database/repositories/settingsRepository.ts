import type { Database } from 'better-sqlite3';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export class SettingsRepository {
  constructor(private db: Database) {}

  public get<T>(key: string, defaultValue?: T): T | undefined {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as SettingRow | undefined;
    if (!row) return defaultValue;

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  public set<T>(key: string, value: T): void {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, serialized, new Date().toISOString());
  }

  public getAll(): Record<string, unknown> {
    const stmt = this.db.prepare('SELECT * FROM settings');
    const rows = stmt.all() as SettingRow[];
    const result: Record<string, unknown> = {};

    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  public delete(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }
}
