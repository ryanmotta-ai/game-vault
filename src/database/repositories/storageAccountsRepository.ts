import type { Database } from 'better-sqlite3';
import { StorageAccount, StorageAccountStatus, StorageProviderType } from '../../core/types';

interface StorageAccountRow {
  id: string;
  provider_type: string;
  account_name: string;
  account_email: string | null;
  status: string;
  quota_total_bytes: number;
  quota_used_bytes: number;
  auth_config_secure_ref: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToAccount(row: StorageAccountRow): StorageAccount {
  return {
    id: row.id,
    providerType: row.provider_type as StorageProviderType,
    accountName: row.account_name,
    accountEmail: row.account_email ?? undefined,
    status: row.status as StorageAccountStatus,
    quotaTotalBytes: row.quota_total_bytes,
    quotaUsedBytes: row.quota_used_bytes,
    authConfigSecureRef: row.auth_config_secure_ref ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class StorageAccountsRepository {
  constructor(private db: Database) {}

  public getAll(): StorageAccount[] {
    const stmt = this.db.prepare('SELECT * FROM storage_accounts ORDER BY created_at ASC');
    const rows = stmt.all() as StorageAccountRow[];
    return rows.map(mapRowToAccount);
  }

  public getById(id: string): StorageAccount | null {
    const stmt = this.db.prepare('SELECT * FROM storage_accounts WHERE id = ?');
    const row = stmt.get(id) as StorageAccountRow | undefined;
    return row ? mapRowToAccount(row) : null;
  }

  public upsert(account: StorageAccount): void {
    const stmt = this.db.prepare(`
      INSERT INTO storage_accounts (
        id, provider_type, account_name, account_email, status,
        quota_total_bytes, quota_used_bytes, auth_config_secure_ref,
        last_synced_at, created_at, updated_at
      ) VALUES (
        @id, @providerType, @accountName, @accountEmail, @status,
        @quotaTotalBytes, @quotaUsedBytes, @authConfigSecureRef,
        @lastSyncedAt, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        provider_type = excluded.provider_type,
        account_name = excluded.account_name,
        account_email = excluded.account_email,
        status = excluded.status,
        quota_total_bytes = excluded.quota_total_bytes,
        quota_used_bytes = excluded.quota_used_bytes,
        auth_config_secure_ref = excluded.auth_config_secure_ref,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: account.id,
      providerType: account.providerType,
      accountName: account.accountName,
      accountEmail: account.accountEmail ?? null,
      status: account.status,
      quotaTotalBytes: account.quotaTotalBytes,
      quotaUsedBytes: account.quotaUsedBytes,
      authConfigSecureRef: account.authConfigSecureRef ?? null,
      lastSyncedAt: account.lastSyncedAt ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    });
  }

  public updateQuota(id: string, totalBytes: number, usedBytes: number): void {
    const stmt = this.db.prepare(`
      UPDATE storage_accounts
      SET quota_total_bytes = ?, quota_used_bytes = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(totalBytes, usedBytes, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM storage_accounts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
