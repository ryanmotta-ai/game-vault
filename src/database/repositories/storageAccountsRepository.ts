import type { Database } from 'better-sqlite3';
import { StorageAccount, StorageAccountStatus, StorageProviderType } from '../../core/types';

interface StorageAccountRow {
  id: string;
  provider_type: string;
  provider_account_id: string;
  account_name: string;
  account_email: string | null;
  credential_key: string;
  status: string;
  quota_total_bytes: number;
  quota_used_bytes: number;
  last_authenticated_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToAccount(row: StorageAccountRow): StorageAccount {
  return {
    id: row.id,
    providerType: row.provider_type as StorageProviderType,
    providerAccountId: row.provider_account_id,
    accountName: row.account_name,
    accountEmail: row.account_email ?? undefined,
    credentialKey: row.credential_key,
    status: row.status as StorageAccountStatus,
    quotaTotalBytes: row.quota_total_bytes,
    quotaUsedBytes: row.quota_used_bytes,
    lastAuthenticatedAt: row.last_authenticated_at ?? undefined,
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

  public getByProviderAccountId(
    providerType: StorageProviderType,
    providerAccountId: string
  ): StorageAccount | null {
    const stmt = this.db.prepare(`
      SELECT * FROM storage_accounts
      WHERE provider_type = ? AND provider_account_id = ?
    `);
    const row = stmt.get(providerType, providerAccountId) as StorageAccountRow | undefined;
    return row ? mapRowToAccount(row) : null;
  }

  public getByStatus(status: StorageAccountStatus): StorageAccount[] {
    const stmt = this.db.prepare('SELECT * FROM storage_accounts WHERE status = ? ORDER BY created_at ASC');
    const rows = stmt.all(status) as StorageAccountRow[];
    return rows.map(mapRowToAccount);
  }

  public upsert(account: StorageAccount): void {
    const stmt = this.db.prepare(`
      INSERT INTO storage_accounts (
        id, provider_type, provider_account_id, account_name,
        account_email, credential_key, status, quota_total_bytes,
        quota_used_bytes, last_authenticated_at, created_at, updated_at
      ) VALUES (
        @id, @providerType, @providerAccountId, @accountName,
        @accountEmail, @credentialKey, @status, @quotaTotalBytes,
        @quotaUsedBytes, @lastAuthenticatedAt, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        provider_type = excluded.provider_type,
        provider_account_id = excluded.provider_account_id,
        account_name = excluded.account_name,
        account_email = excluded.account_email,
        credential_key = excluded.credential_key,
        status = excluded.status,
        quota_total_bytes = excluded.quota_total_bytes,
        quota_used_bytes = excluded.quota_used_bytes,
        last_authenticated_at = excluded.last_authenticated_at,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: account.id,
      providerType: account.providerType,
      providerAccountId: account.providerAccountId,
      accountName: account.accountName,
      accountEmail: account.accountEmail ?? null,
      credentialKey: account.credentialKey,
      status: account.status,
      quotaTotalBytes: account.quotaTotalBytes,
      quotaUsedBytes: account.quotaUsedBytes,
      lastAuthenticatedAt: account.lastAuthenticatedAt ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    });
  }

  public updateStatus(id: string, status: StorageAccountStatus): void {
    const stmt = this.db.prepare(`
      UPDATE storage_accounts
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, new Date().toISOString(), id);
  }

  public updateQuota(id: string, totalBytes: number, usedBytes: number): void {
    const stmt = this.db.prepare(`
      UPDATE storage_accounts
      SET quota_total_bytes = ?, quota_used_bytes = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(totalBytes, usedBytes, new Date().toISOString(), id);
  }

  public updateLastAuthenticated(id: string, timestamp: string): void {
    const stmt = this.db.prepare(`
      UPDATE storage_accounts
      SET last_authenticated_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(timestamp, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM storage_accounts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
