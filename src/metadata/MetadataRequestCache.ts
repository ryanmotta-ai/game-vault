interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  isNegative?: boolean;
}

export interface MetadataCacheStats {
  size: number;
  hits: number;
  misses: number;
  negativeEntries: number;
}

export class MetadataRequestCache {
  private cache = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;

  public static readonly DEFAULT_TTL_SECONDS = 3600; // 1 hour
  public static readonly NEGATIVE_TTL_SECONDS = 86400; // 24 hours

  /**
   * Generates a deterministic cache key from provider, operation, and parameters.
   */
  public generateKey(providerId: string, operation: string, params: Record<string, any> | string): string {
    const serializedParams = typeof params === 'string'
      ? params.toLowerCase().trim()
      : Object.keys(params)
          .sort()
          .map((k) => `${k}:${String(params[k]).toLowerCase().trim()}`)
          .join('|');
    return `${providerId.toLowerCase()}:${operation.toLowerCase()}:${serializedParams}`;
  }

  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    if (entry.isNegative) {
      this.hits++;
      return null;
    }

    this.hits++;
    return entry.data as T;
  }

  public isNegative(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return Boolean(entry.isNegative);
  }

  public has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  public set<T>(key: string, data: T, ttlSeconds: number = MetadataRequestCache.DEFAULT_TTL_SECONDS): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, {
      data,
      expiresAt,
      isNegative: false
    });
  }

  public setNegative(key: string, ttlSeconds: number = MetadataRequestCache.NEGATIVE_TTL_SECONDS): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, {
      data: null,
      expiresAt,
      isNegative: true
    });
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public pruneExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  public getStats(): MetadataCacheStats {
    let negativeEntries = 0;
    const now = Date.now();
    for (const [, entry] of this.cache.entries()) {
      if (now <= entry.expiresAt && entry.isNegative) {
        negativeEntries++;
      }
    }
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      negativeEntries
    };
  }
}
