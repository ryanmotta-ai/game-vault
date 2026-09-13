import { BlockCache } from './BlockCache';
import { NetworkQuality } from '../core/types';
import { logger } from '../core/logger';

export type ReadPriority = 'REQUESTED' | 'PREFETCH' | 'BACKGROUND';

export interface PrefetchQueueItem {
  blockIndex: number;
  priority: ReadPriority;
  timestamp: number;
}

export interface PrefetchCoordinatorOptions {
  blockCache?: BlockCache;
  baseReadAheadBlocks?: number;
  maxReadAheadBlocks?: number;
  maxConcurrent?: number;
  maxReadAhead?: number;
}

export class PrefetchCoordinator {
  private log = logger.child('PrefetchCoordinator');
  private blockCache: BlockCache;
  private maxConcurrent: number;
  private baseReadAheadBlocks: number;
  private maxReadAheadBlocks: number;
  private currentWindow: number;

  private activeRequests = 0;
  private queue: PrefetchQueueItem[] = [];
  private lastRequestedBlock = -1;
  private sequentialStreak = 0;
  private networkQuality: NetworkQuality = 'GOOD';

  private prefetchedSet = new Set<number>();
  private prefetchHits = 0;
  private bytesPrefetched = 0;

  constructor(
    blockCacheOrOptions: BlockCache | PrefetchCoordinatorOptions,
    options?: PrefetchCoordinatorOptions
  ) {
    if (blockCacheOrOptions instanceof BlockCache) {
      this.blockCache = blockCacheOrOptions;
      this.baseReadAheadBlocks = options?.baseReadAheadBlocks ?? options?.maxReadAhead ?? 2;
      this.maxReadAheadBlocks = options?.maxReadAheadBlocks ?? 4;
      this.maxConcurrent = options?.maxConcurrent ?? 2;
    } else {
      this.blockCache = blockCacheOrOptions.blockCache!;
      this.baseReadAheadBlocks =
        blockCacheOrOptions.baseReadAheadBlocks ?? blockCacheOrOptions.maxReadAhead ?? 2;
      this.maxReadAheadBlocks = blockCacheOrOptions.maxReadAheadBlocks ?? 4;
      this.maxConcurrent = blockCacheOrOptions.maxConcurrent ?? 2;
    }
    this.currentWindow = this.baseReadAheadBlocks;
  }

  public getPrefetchHits(): number {
    return this.prefetchHits;
  }

  public getBytesPrefetched(): number {
    return this.bytesPrefetched;
  }

  public getCurrentWindow(): number {
    return this.currentWindow;
  }

  public setNetworkQuality(quality: NetworkQuality): void {
    this.networkQuality = quality;
    if (quality === 'POOR') {
      this.currentWindow = 1;
    } else if (quality === 'FAIR') {
      this.currentWindow = Math.min(this.currentWindow, this.baseReadAheadBlocks);
    }
  }

  private priorityValue(p: ReadPriority): number {
    switch (p) {
      case 'REQUESTED':
        return 3;
      case 'PREFETCH':
        return 2;
      case 'BACKGROUND':
        return 1;
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const diff = this.priorityValue(b.priority) - this.priorityValue(a.priority);
      if (diff !== 0) return diff;
      return a.timestamp - b.timestamp;
    });
  }

  public schedulePrefetch(blockIndex: number, priority: ReadPriority = 'PREFETCH'): void {
    if (blockIndex < 0 || blockIndex >= this.blockCache.blockCount) return;
    if (this.blockCache.isBlockCached(blockIndex)) return;

    const existingIdx = this.queue.findIndex((item) => item.blockIndex === blockIndex);
    if (existingIdx !== -1) {
      const existing = this.queue[existingIdx];
      if (this.priorityValue(priority) > this.priorityValue(existing.priority)) {
        existing.priority = priority;
      }
      this.sortQueue();
      return;
    }

    this.queue.push({
      blockIndex,
      priority,
      timestamp: Date.now()
    });
    this.sortQueue();
    this.drainQueue();
  }

  public getQueueSnapshot(): PrefetchQueueItem[] {
    return [...this.queue];
  }

  public onBlockRequested(blockIndex: number): void {
    if (this.prefetchedSet.has(blockIndex)) {
      this.prefetchHits++;
      this.prefetchedSet.delete(blockIndex);
    }

    // Adaptive sequential detection
    if (this.lastRequestedBlock !== -1) {
      if (blockIndex === this.lastRequestedBlock + 1) {
        this.sequentialStreak++;
        if (this.sequentialStreak >= 2) {
          this.currentWindow = Math.min(this.currentWindow + 1, this.maxReadAheadBlocks);
        }
      } else if (Math.abs(blockIndex - this.lastRequestedBlock) > 1) {
        // Random access jump: reset streak and purge unstarted non-requested prefetches
        this.sequentialStreak = 0;
        this.currentWindow = this.baseReadAheadBlocks;
        this.queue = this.queue.filter((i) => i.priority === 'REQUESTED');
      }
    } else {
      this.sequentialStreak = 1;
      this.currentWindow = this.baseReadAheadBlocks;
    }

    this.lastRequestedBlock = blockIndex;

    // Trigger read-ahead
    const windowToUse = this.networkQuality === 'POOR' ? 1 : this.currentWindow;
    for (let offset = 1; offset <= windowToUse; offset++) {
      const candidate = blockIndex + offset;
      this.schedulePrefetch(candidate, 'PREFETCH');
    }
  }

  private drainQueue(): void {
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const nextItem = this.queue.shift();
      if (!nextItem) break;

      const nextBlock = nextItem.blockIndex;
      if (this.blockCache.isBlockCached(nextBlock)) {
        continue;
      }

      this.activeRequests++;
      this.prefetchedSet.add(nextBlock);

      this.blockCache
        .getBlock(nextBlock)
        .then((data) => {
          this.bytesPrefetched += data.length;
        })
        .catch((err) => {
          this.log.debug(`Prefetch for block ${nextBlock} aborted or failed:`, err.message);
        })
        .finally(() => {
          this.activeRequests--;
          this.drainQueue();
        });
    }
  }

  public scheduleBackgroundFill(startBlock = 0): void {
    for (let b = startBlock; b < this.blockCache.blockCount; b++) {
      if (!this.blockCache.isBlockCached(b)) {
        this.schedulePrefetch(b, 'BACKGROUND');
      }
    }
  }

  public clear(): void {
    this.queue = [];
    this.prefetchedSet.clear();
    this.sequentialStreak = 0;
    this.lastRequestedBlock = -1;
  }
}
