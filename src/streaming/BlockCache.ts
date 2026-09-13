import fs from 'node:fs';
import path from 'node:path';
import { StreamingBlockManifest } from '../core/types';
import { RangeReader } from './RangeReader';
import { logger } from '../core/logger';

export interface BlockCacheOptions {
  streamingRootDir?: string;
  fileDir?: string;
  gameFileId?: string;
  fileId?: string;
  remoteFileId: string;
  storageAccountId?: string;
  accountId?: string;
  expectedSize: number;
  remoteVersion: string;
  blockSize?: number; // Default 4 MB (4194304 bytes)
  rangeReader: RangeReader;
  maxCacheBytes?: number;
}

export class BlockCache {
  private log = logger.child('BlockCache');
  public readonly blockSize: number;
  public readonly blockCount: number;
  public readonly fileDir: string;
  public readonly blocksDir: string;
  public readonly manifestPath: string;

  private manifest: StreamingBlockManifest;
  private rangeReader: RangeReader;
  private maxCacheBytes: number;
  private inFlightRequests = new Map<number, Promise<Buffer>>();
  private lockedBlocks = new Set<number>();

  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(options: BlockCacheOptions) {
    this.blockSize = options.blockSize ?? 4 * 1024 * 1024; // 4 MB default
    this.blockCount = Math.max(1, Math.ceil(options.expectedSize / this.blockSize));
    this.rangeReader = options.rangeReader;
    this.maxCacheBytes = options.maxCacheBytes ?? 50 * 1024 * 1024 * 1024; // 50 GB default

    this.fileDir =
      options.fileDir ??
      path.join(options.streamingRootDir ?? '', options.gameFileId ?? options.fileId ?? 'default');
    this.blocksDir = path.join(this.fileDir, 'blocks');
    this.manifestPath = path.join(this.fileDir, 'manifest.json');

    this.manifest = this.loadOrCreateManifest(options);
  }

  private formatBlockFileName(blockIndex: number): string {
    return `${blockIndex.toString().padStart(8, '0')}.blk`;
  }

  public getBlockPath(blockIndex: number): string {
    return path.join(this.blocksDir, this.formatBlockFileName(blockIndex));
  }

  private loadOrCreateManifest(options: BlockCacheOptions): StreamingBlockManifest {
    fs.mkdirSync(this.blocksDir, { recursive: true });

    if (fs.existsSync(this.manifestPath)) {
      try {
        const raw = fs.readFileSync(this.manifestPath, 'utf8');
        const parsed = JSON.parse(raw) as StreamingBlockManifest;

        // Verify remote version identity. If version changed, invalidate blocks!
        if (
          parsed.remoteVersion === options.remoteVersion &&
          parsed.expectedSize === options.expectedSize &&
          parsed.blockSize === this.blockSize
        ) {
          // Re-verify cached blocks presence on disk
          const verifiedBlocks = parsed.cachedBlocks.filter((idx) =>
            fs.existsSync(this.getBlockPath(idx))
          );
          parsed.cachedBlocks = verifiedBlocks;
          return parsed;
        } else {
          this.log.warn(
            `Remote version or size changed for file ${options.gameFileId}. Invalidating block cache.`
          );
          this.purgeAllBlocks();
        }
      } catch (err) {
        this.log.error('Error reading streaming manifest. Re-creating...', err);
        this.purgeAllBlocks();
      }
    }

    const now = new Date().toISOString();
    const manifest: StreamingBlockManifest = {
      fileId: options.gameFileId ?? options.fileId ?? 'file',
      remoteFileId: options.remoteFileId,
      accountId: options.storageAccountId ?? options.accountId ?? 'account',
      expectedSize: options.expectedSize,
      blockSize: this.blockSize,
      blockCount: this.blockCount,
      remoteVersion: options.remoteVersion,
      cachedBlocks: [],
      createdAt: now,
      updatedAt: now
    };

    this.saveManifest(manifest);
    return manifest;
  }

  public getManifest(): StreamingBlockManifest {
    return this.manifest;
  }

  public saveManifest(manifest: StreamingBlockManifest = this.manifest): void {
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  public purgeAllBlocks(): void {
    if (fs.existsSync(this.blocksDir)) {
      try {
        const files = fs.readdirSync(this.blocksDir);
        for (const f of files) {
          fs.unlinkSync(path.join(this.blocksDir, f));
        }
      } catch {}
    }
    if (this.manifest) {
      this.manifest.cachedBlocks = [];
    }
  }

  public isBlockCached(blockIndex: number): boolean {
    return fs.existsSync(this.getBlockPath(blockIndex));
  }

  public getCachedBlocksCount(): number {
    return this.manifest.cachedBlocks.length;
  }

  public getCachedBytes(): number {
    return this.manifest.cachedBlocks.length * this.blockSize;
  }

  public isFullyCached(): boolean {
    return this.manifest.cachedBlocks.length >= this.blockCount;
  }

  public getCacheStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 1.0
    };
  }

  public lockBlock(blockIndex: number): void {
    this.lockedBlocks.add(blockIndex);
  }

  public unlockBlock(blockIndex: number): void {
    this.lockedBlocks.delete(blockIndex);
  }

  /**
   * Reads a logical block by index. Deduplicates in-flight network requests.
   */
  public async getBlock(blockIndex: number, signal?: AbortSignal): Promise<Buffer> {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(`Block index ${blockIndex} is out of bounds (0-${this.blockCount - 1})`);
    }

    const blockPath = this.getBlockPath(blockIndex);

    // 1. Cache hit on local disk
    if (fs.existsSync(blockPath)) {
      this.cacheHits++;
      try {
        // Touch mtime for LRU ranking
        fs.utimesSync(blockPath, new Date(), new Date());
        return fs.readFileSync(blockPath);
      } catch {
        // Fallback to fetch if read fails
      }
    }

    this.cacheMisses++;

    // 2. In-flight request deduplication
    const active = this.inFlightRequests.get(blockIndex);
    if (active) {
      return active;
    }

    // 3. Fetch missing block from remote provider
    const fetchPromise = (async () => {
      this.lockBlock(blockIndex);
      try {
        const startByte = blockIndex * this.blockSize;
        const endByte = Math.min(startByte + this.blockSize - 1, this.manifest.expectedSize - 1);

        const result = await this.rangeReader.readRange(startByte, endByte, signal);
        const data = result.data;

        // Ensure blocks directory exists
        if (!fs.existsSync(this.blocksDir)) {
          fs.mkdirSync(this.blocksDir, { recursive: true });
        }

        // Save block atomically
        const tempPath = `${blockPath}.tmp_${Date.now()}`;
        fs.writeFileSync(tempPath, data);
        fs.renameSync(tempPath, blockPath);

        if (!this.manifest.cachedBlocks.includes(blockIndex)) {
          this.manifest.cachedBlocks.push(blockIndex);
          this.manifest.cachedBlocks.sort((a, b) => a - b);
          this.saveManifest();
        }

        if (this.getCachedBytes() > this.maxCacheBytes) {
          this.evictLruBlocks(this.blockSize * 2);
        }

        return data;
      } finally {
        this.unlockBlock(blockIndex);
        this.inFlightRequests.delete(blockIndex);
      }
    })();

    this.inFlightRequests.set(blockIndex, fetchPromise);
    return fetchPromise;
  }

  public getMaxCacheBytes(): number {
    return this.maxCacheBytes;
  }

  /**
   * Reads an arbitrary byte range from the file using logical blocks.
   */
  public async readRange(start: number, end: number, signal?: AbortSignal): Promise<Buffer> {
    const clampedEnd = Math.min(end, this.manifest.expectedSize - 1);
    if (start > clampedEnd) {
      return Buffer.alloc(0);
    }

    const startBlock = Math.floor(start / this.blockSize);
    const endBlock = Math.floor(clampedEnd / this.blockSize);

    const buffers: Buffer[] = [];

    for (let b = startBlock; b <= endBlock; b++) {
      const blockData = await this.getBlock(b, signal);
      const blockStart = b * this.blockSize;

      const sliceStart = Math.max(0, start - blockStart);
      const sliceEnd = Math.min(blockData.length, clampedEnd - blockStart + 1);

      buffers.push(blockData.subarray(sliceStart, sliceEnd));
    }

    return Buffer.concat(buffers);
  }

  /**
   * Materializes all cached blocks into a continuous file on disk.
   */
  public async materializeFile(destinationPath: string): Promise<boolean> {
    if (!this.isFullyCached()) {
      return false;
    }

    const parentDir = path.dirname(destinationPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const tempDest = `${destinationPath}.mat_${Date.now()}`;
    const fd = fs.openSync(tempDest, 'w');

    try {
      for (let i = 0; i < this.blockCount; i++) {
        const blockPath = this.getBlockPath(i);
        const data = fs.readFileSync(blockPath);
        fs.writeSync(fd, data, 0, data.length);
      }
      fs.closeSync(fd);
      fs.renameSync(tempDest, destinationPath);
      return true;
    } catch (err) {
      this.log.error('Failed to materialize file from blocks:', err);
      try {
        fs.closeSync(fd);
        if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      } catch {}
      return false;
    }
  }

  /**
   * Evicts least recently used unlocked blocks when cache limit is exceeded.
   */
  public evictLruBlocks(targetFreeBytes: number): number {
    let freedBytes = 0;
    if (!fs.existsSync(this.blocksDir)) return 0;

    const blockFiles = fs.readdirSync(this.blocksDir).filter((f) => f.endsWith('.blk'));
    const blockStats: Array<{ index: number; path: string; size: number; mtime: number }> = [];

    for (const file of blockFiles) {
      const fullPath = path.join(this.blocksDir, file);
      try {
        const stat = fs.statSync(fullPath);
        const index = parseInt(file.replace('.blk', ''), 10);
        blockStats.push({ index, path: fullPath, size: stat.size, mtime: stat.mtimeMs });
      } catch {}
    }

    // Sort oldest mtime first
    blockStats.sort((a, b) => a.mtime - b.mtime);

    for (const item of blockStats) {
      if (freedBytes >= targetFreeBytes) break;
      if (this.lockedBlocks.has(item.index)) {
        // Skip locked/active blocks
        continue;
      }

      try {
        fs.unlinkSync(item.path);
        freedBytes += item.size;
        this.manifest.cachedBlocks = this.manifest.cachedBlocks.filter((b) => b !== item.index);
      } catch {}
    }

    if (freedBytes > 0) {
      this.saveManifest();
    }

    return freedBytes;
  }
}
