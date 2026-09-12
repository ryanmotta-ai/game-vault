import { StorageProvider } from '../providers/StorageProvider';
import { ProviderFactory } from '../providers/ProviderFactory';
import { StorageAccount, StorageQuotaSummary } from '../core/types';
import { cacheManager, CacheManager } from './CacheManager';
import { logger } from '../core/logger';
import { NotFoundError } from '../core/errors/AppError';

export class StorageManager {
  private static instance: StorageManager;
  private providers = new Map<string, StorageProvider>();
  private log = logger.child('StorageManager');
  private cache: CacheManager;

  private constructor() {
    this.cache = cacheManager;
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  public registerProvider(account: StorageAccount): StorageProvider {
    const provider = ProviderFactory.create(account.providerType, {
      accountId: account.id,
      accountName: account.accountName,
      accountEmail: account.accountEmail,
      tokenRef: account.authConfigSecureRef
    });

    this.providers.set(account.id, provider);
    this.log.info(`Registered provider for account '${account.accountName}' (${account.providerType})`);
    return provider;
  }

  public getProvider(accountId: string): StorageProvider {
    const provider = this.providers.get(accountId);
    if (!provider) {
      throw new NotFoundError(`No active provider registered for account ID: ${accountId}`);
    }
    return provider;
  }

  public async getQuotaSummary(accounts: StorageAccount[]): Promise<StorageQuotaSummary> {
    let cloudTotal = 0;
    let cloudUsed = 0;

    for (const acc of accounts) {
      cloudTotal += acc.quotaTotalBytes || 0;
      cloudUsed += acc.quotaUsedBytes || 0;
    }

    const cacheInfo = this.cache.getCacheInfo();

    return {
      cloudTotalBytes: cloudTotal,
      cloudUsedBytes: cloudUsed,
      localCachePath: cacheInfo.path,
      localCacheUsedBytes: cacheInfo.totalSizeBytes,
      localCacheAvailableBytes: cacheInfo.freeDiskBytes,
      connectedAccountsCount: accounts.length
    };
  }
}

export const storageManager = StorageManager.getInstance();
