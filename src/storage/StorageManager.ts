import { StorageProvider } from '../providers/StorageProvider';
import { ProviderFactory } from '../providers/ProviderFactory';
import { StorageAccount, StorageProviderType, StorageQuotaSummary } from '../core/types';
import { cacheManager, CacheManager } from './CacheManager';
import { logger } from '../core/logger';
import { NotFoundError, AccountAlreadyConnectedError } from '../core/errors/AppError';
import { StorageAccountsRepository } from '../database/repositories/storageAccountsRepository';
import { GoogleDriveProvider } from '../providers/google-drive/GoogleDriveProvider';

export class StorageManager {
  private static instance: StorageManager;
  private providers = new Map<string, StorageProvider>();
  private log = logger.child('StorageManager');
  private cache: CacheManager;
  private accountsRepo?: StorageAccountsRepository;

  private constructor() {
    this.cache = cacheManager;
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  public setRepository(repo: StorageAccountsRepository): void {
    this.accountsRepo = repo;
  }

  /**
   * Initializes all active accounts registered in database on startup.
   */
  public initializeAccounts(accounts: StorageAccount[]): void {
    this.log.info(`Initializing ${accounts.length} storage accounts into StorageManager...`);
    for (const acc of accounts) {
      if (acc.status === 'ACTIVE') {
        try {
          this.registerProvider(acc);
        } catch (err) {
          this.log.warn(`Could not register provider for account '${acc.accountName}' (${acc.id}):`, err);
        }
      }
    }
  }

  public registerProvider(account: StorageAccount): StorageProvider {
    const provider = ProviderFactory.create(account.providerType, {
      accountId: account.id,
      accountName: account.accountName,
      providerAccountId: account.providerAccountId,
      accountEmail: account.accountEmail,
      credentialKey: account.credentialKey
    });

    this.providers.set(account.id, provider);
    this.log.info(`Registered multi-account provider '${account.accountName}' (${account.id}) [Type: ${account.providerType}]`);
    return provider;
  }

  public getProvider(accountId: string): StorageProvider {
    const provider = this.providers.get(accountId);
    if (!provider) {
      throw new NotFoundError(`No active provider registered for account ID: ${accountId}`);
    }
    return provider;
  }

  public hasProvider(accountId: string): boolean {
    return this.providers.has(accountId);
  }

  /**
   * Initiates authentication for a new or existing storage account.
   * Enables connecting multiple independent Google Drive accounts simultaneously.
   */
  public async connectAccount(
    providerType: StorageProviderType,
    customName?: string
  ): Promise<StorageAccount> {
    this.log.info(`Connecting new storage account of type '${providerType}'...`);

    const tempId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const tempCredentialKey = `${providerType}:${tempId}`;

    const tempProvider = ProviderFactory.create(providerType, {
      accountId: tempId,
      accountName: customName || 'Google Drive',
      credentialKey: tempCredentialKey
    });

    const authResult = await tempProvider.authenticate();
    if (!authResult.success) {
      throw new Error(authResult.error || 'Authentication failed');
    }

    const gdrive = tempProvider as GoogleDriveProvider;
    const providerAccountId = gdrive.providerAccountId || tempId;
    const accountEmail = authResult.accountEmail;

    // Check if account is already registered
    if (this.accountsRepo) {
      const existing = this.accountsRepo.getByProviderAccountId(providerType, providerAccountId);
      if (existing && existing.status === 'ACTIVE') {
        // Disconnect temp
        await tempProvider.disconnect();
        throw new AccountAlreadyConnectedError(accountEmail);
      }
    }

    // Fetch initial quota
    let quotaTotal = 15 * 1024 * 1024 * 1024;
    let quotaUsed = 0;
    try {
      const quota = await tempProvider.getQuota();
      quotaTotal = quota.totalBytes;
      quotaUsed = quota.usedBytes;
    } catch (err) {
      this.log.warn('Could not fetch quota immediately upon connection:', err);
    }

    const now = new Date().toISOString();
    const account: StorageAccount = {
      id: tempId,
      providerType,
      providerAccountId,
      accountName: customName || authResult.accountName || 'Google Drive Account',
      accountEmail,
      credentialKey: tempCredentialKey,
      status: 'ACTIVE',
      quotaTotalBytes: quotaTotal,
      quotaUsedBytes: quotaUsed,
      createdAt: now,
      updatedAt: now,
      lastAuthenticatedAt: now
    };

    if (this.accountsRepo) {
      this.accountsRepo.upsert(account);
    }

    this.providers.set(account.id, tempProvider);
    this.log.info(`Successfully connected and registered account '${account.accountName}' (${account.id})`);
    return account;
  }

  /**
   * Disconnects a specific account without affecting other accounts.
   * Removes credentials and updates status to DISCONNECTED.
   */
  public async disconnectAccount(accountId: string): Promise<void> {
    this.log.info(`Disconnecting account ID: ${accountId}`);

    const provider = this.providers.get(accountId);
    if (provider) {
      await provider.disconnect();
      this.providers.delete(accountId);
    }

    if (this.accountsRepo) {
      this.accountsRepo.updateStatus(accountId, 'DISCONNECTED');
    }

    this.log.info(`Account ${accountId} disconnected successfully.`);
  }

  /**
   * Reconnects an existing account.
   */
  public async reconnectAccount(accountId: string): Promise<StorageAccount> {
    this.log.info(`Reconnecting account ID: ${accountId}`);

    if (!this.accountsRepo) {
      throw new NotFoundError('Storage accounts repository not configured.');
    }

    const account = this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError(`Account not found with ID: ${accountId}`);
    }

    const provider = ProviderFactory.create(account.providerType, {
      accountId: account.id,
      accountName: account.accountName,
      providerAccountId: account.providerAccountId,
      accountEmail: account.accountEmail,
      credentialKey: account.credentialKey
    });

    const authResult = await provider.authenticate();
    if (!authResult.success) {
      throw new Error(authResult.error || 'Re-authentication failed');
    }

    try {
      const quota = await provider.getQuota();
      this.accountsRepo.updateQuota(accountId, quota.totalBytes, quota.usedBytes);
      account.quotaTotalBytes = quota.totalBytes;
      account.quotaUsedBytes = quota.usedBytes;
    } catch {
      // Keep previous quota if transient error
    }

    const now = new Date().toISOString();
    this.accountsRepo.updateStatus(accountId, 'ACTIVE');
    this.accountsRepo.updateLastAuthenticated(accountId, now);
    account.status = 'ACTIVE';
    account.lastAuthenticatedAt = now;

    this.providers.set(accountId, provider);
    this.log.info(`Account '${account.accountName}' reconnected successfully.`);
    return account;
  }

  public getActiveAccountsCount(): number {
    return this.providers.size;
  }

  public async getQuotaSummary(accounts: StorageAccount[]): Promise<StorageQuotaSummary> {
    let cloudTotal = 0;
    let cloudUsed = 0;
    let activeCount = 0;

    for (const acc of accounts) {
      if (acc.status === 'ACTIVE') {
        cloudTotal += acc.quotaTotalBytes || 0;
        cloudUsed += acc.quotaUsedBytes || 0;
        activeCount++;
      }
    }

    const cacheInfo = this.cache.getCacheInfo();

    return {
      cloudTotalBytes: cloudTotal,
      cloudUsedBytes: cloudUsed,
      localCachePath: cacheInfo.path,
      localCacheUsedBytes: cacheInfo.totalSizeBytes,
      localCacheAvailableBytes: cacheInfo.freeDiskBytes,
      connectedAccountsCount: activeCount
    };
  }
}

export const storageManager = StorageManager.getInstance();
