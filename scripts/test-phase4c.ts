import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';

import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { GameManifestsRepository } from '../src/database/repositories/gameManifestsRepository';
import { LaunchProfilesRepository } from '../src/database/repositories/launchProfilesRepository';
import { EmulatorsRepository } from '../src/database/repositories/emulatorsRepository';
import { GameSessionsRepository } from '../src/database/repositories/gameSessionsRepository';

import { PlaybackStrategyResolver } from '../src/streaming/PlaybackStrategyResolver';
import { RangeReader } from '../src/streaming/RangeReader';
import { BlockCache } from '../src/streaming/BlockCache';
import { PrefetchCoordinator } from '../src/streaming/PrefetchCoordinator';
import { NetworkCapabilityEstimator } from '../src/streaming/NetworkCapabilityEstimator';
import { LocalhostStreamServer } from '../src/streaming/LocalhostStreamServer';
import { InstantHydrationService } from '../src/streaming/InstantHydrationService';
import { LauncherManager } from '../src/launchers/LauncherManager';
import { CacheManager } from '../src/storage/CacheManager';
import { StorageManager } from '../src/storage/StorageManager';
import { StorageProvider } from '../src/providers/StorageProvider';

import {
  Game,
  GameFile,
  LaunchProfile,
  RangeReadResult
} from '../src/core/types';

import {
  RangeOutOfBoundsError,
  InvalidRangeResponseError,
  RateLimitedError,
  DownloadCancelledError
} from '../src/core/errors/AppError';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

const TEST_TMP = path.resolve(__dirname, '../.test_phase4c_tmp');

function cleanTestTmp() {
  if (fs.existsSync(TEST_TMP)) {
    try {
      fs.rmSync(TEST_TMP, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock cleanup errors
    }
  }
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Mock StorageProvider for testing Range Reads
class MockRangeStorageProvider implements StorageProvider {
  public id: string;
  public readonly name = 'Mock Range Provider';
  public readonly type = 'google_drive' as const;
  public readonly supportsRangeReads = true;

  public rangeReadCallCount = 0;
  public mockData: Buffer;
  public failCount = 0;
  public failWith429 = false;
  public failNon206 = false;

  constructor(size: number = 16 * 1024 * 1024, id = 'mock_range_provider') {
    this.id = id;
    this.mockData = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      this.mockData[i] = i % 256;
    }
  }

  async readRange(_fileId: string, start: number, end: number, signal?: AbortSignal): Promise<RangeReadResult> {
    this.rangeReadCallCount++;

    if (signal?.aborted) {
      throw new DownloadCancelledError();
    }

    if (this.failWith429 && this.failCount > 0) {
      this.failCount--;
      throw new RateLimitedError('Storage API rate limit exceeded.', 50);
    }

    if (this.failNon206) {
      throw new InvalidRangeResponseError('Expected 206 Partial Content', { status: 200 });
    }

    if (start < 0 || end < start || start >= this.mockData.length) {
      throw new RangeOutOfBoundsError(start, end, this.mockData.length);
    }

    const clampedEnd = Math.min(end, this.mockData.length - 1);
    const slice = this.mockData.subarray(start, clampedEnd + 1);

    return {
      data: Buffer.from(slice),
      contentRange: `bytes ${start}-${clampedEnd}/${this.mockData.length}`,
      totalSize: this.mockData.length
    };
  }

  async download(
    requestOrFileId: any,
    destinationPathOrOnProgress?: any,
    onProgress?: any
  ): Promise<any> {
    const destPath = typeof requestOrFileId === 'string' ? destinationPathOrOnProgress : requestOrFileId?.destinationPath;
    const progCb = typeof destinationPathOrOnProgress === 'function' ? destinationPathOrOnProgress : onProgress;
    if (destPath && !fs.existsSync(path.dirname(destPath))) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    }
    if (destPath) {
      fs.writeFileSync(destPath, this.mockData);
    }
    progCb?.({
      bytesTransferred: this.mockData.length,
      totalBytes: this.mockData.length,
      speedBps: 1024 * 1024,
      percentage: 100
    });
    return { success: true, bytesDownloaded: this.mockData.length, timeTakenMs: 10 };
  }

  async authenticate(): Promise<any> { return { success: true, accountId: this.id, email: 'mock@test.com' }; }
  async isConnected(): Promise<boolean> { return true; }
  async getQuota(): Promise<any> { return { totalBytes: 1000000, usedBytes: 500000, freeBytes: 500000 }; }
  async listFiles(): Promise<any> { return []; }
  async getFile(): Promise<any> { return null; }
  async getMetadata(): Promise<any> { return null; }
  async disconnect(): Promise<void> {}
}

async function runPhase4CTests() {
  console.log('====================================================');
  console.log('  GAME VAULT — PHASE 4C TEST SUITE');
  console.log('  Instant Play, Progressive Streaming & Range Engine');
  console.log('====================================================\n');

  cleanTestTmp();
  fs.mkdirSync(TEST_TMP, { recursive: true });

  const db = new Database(':memory:');
  initializeDatabaseSchema(db);

  const gamesRepo = new GamesRepository(db);
  const gameFilesRepo = new GameFilesRepository(db);
  const gameManifestsRepo = new GameManifestsRepository(db);
  const launchProfilesRepo = new LaunchProfilesRepository(db);
  const emulatorsRepo = new EmulatorsRepository(db);
  const gameSessionsRepo = new GameSessionsRepository(db);

  const cacheDir = path.join(TEST_TMP, 'cache');
  const cacheManager = new CacheManager(cacheDir);

  let passed = 0;
  let total = 41;

  // Helper to log test progress
  function report(num: number, title: string) {
    passed++;
    console.log(`[PASS ${num}/${total}] ${title}`);
  }

  // =========================================================================
  // Category 1: Strategy Resolution (Scenarios 1 - 9)
  // =========================================================================
  console.log('--- Category 1: Strategy Resolution (Scenarios 1 - 9) ---');
  const resolver = new PlaybackStrategyResolver(128 * 1024 * 1024);

  // Scenario 1: Retro small ROM (SNES 4 MB) resolves to INSTANT_HYDRATION
  {
    const game: Game = {
      id: 'g_snes_1',
      title: 'Super Mario World',
      slug: 'smw',
      platform: 'SNES',
      state: 'CLOUD',
      sizeBytes: 4 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const res = resolver.resolve({ game });
    assert(res.strategy === 'INSTANT_HYDRATION', 'Small SNES game should resolve to INSTANT_HYDRATION');
    assert((res.estimatedHydrationTimeMs ?? 0) <= 2000, 'Estimated hydration should be quick (<2s)');
    report(1, 'Small SNES game (4 MB) resolves to INSTANT_HYDRATION');
  }

  // Scenario 2: Other retro consoles (NES, GBA, Retro) resolve to INSTANT_HYDRATION
  {
    const nesGame: Game = {
      id: 'g_nes_1',
      title: 'Mega Man 2',
      slug: 'mm2',
      platform: 'NES',
      state: 'CLOUD',
      sizeBytes: 512 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const gbaGame: Game = {
      id: 'g_gba_1',
      title: 'Metroid Fusion',
      slug: 'mf',
      platform: 'Game Boy Advance',
      state: 'CLOUD',
      sizeBytes: 16 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    assert(resolver.resolve({ game: nesGame }).strategy === 'INSTANT_HYDRATION', 'NES resolves to INSTANT_HYDRATION');
    assert(resolver.resolve({ game: gbaGame }).strategy === 'INSTANT_HYDRATION', 'GBA resolves to INSTANT_HYDRATION');
    report(2, 'Multiple retro platforms (NES, GBA) resolve to INSTANT_HYDRATION');
  }

  // Scenario 3: Retro oversized file (> 128 MB) resolves to LOCAL_REQUIRED
  {
    const hugeRetroGame: Game = {
      id: 'g_huge_retro',
      title: 'Massive Homebrew',
      slug: 'huge-hb',
      platform: 'Nintendo DS',
      state: 'CLOUD',
      sizeBytes: 250 * 1024 * 1024, // 250 MB > 128 MB threshold
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const res = resolver.resolve({ game: hugeRetroGame });
    assert(res.strategy === 'LOCAL_REQUIRED', 'Oversized retro ROM must resolve to LOCAL_REQUIRED');
    report(3, 'Oversized retro file (> 128 MB) resolves to LOCAL_REQUIRED');
  }

  // Scenario 4: PS1 .chd with Range support & GOOD network resolves to PROGRESSIVE_PLAY
  {
    const ps1Game: Game = {
      id: 'g_ps1_1',
      title: 'Castlevania: Symphony of the Night',
      slug: 'sotn',
      platform: 'PlayStation',
      state: 'CLOUD',
      sizeBytes: 450 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const ps1File: GameFile = {
      id: 'gf_ps1',
      gameId: ps1Game.id,
      storageAccountId: 'acc_1',
      remoteFileId: 'rem_sotn',
      remotePath: '/PS1/sotn.chd',
      filename: 'sotn.chd',
      sizeBytes: ps1Game.sizeBytes,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const mockProvider = new MockRangeStorageProvider();
    const res = resolver.resolve({
      game: ps1Game,
      gameFile: ps1File,
      provider: mockProvider,
      networkQuality: 'GOOD'
    });
    assert(res.strategy === 'PROGRESSIVE_PLAY', 'PS1 with .chd and Range provider should resolve to PROGRESSIVE_PLAY');
    assert(res.isStreamable === true, 'Streamable flag must be true');
    report(4, 'PS1 with .chd, Range support and GOOD network resolves to PROGRESSIVE_PLAY');
  }

  // Scenario 5: PS1 without Range support falls back to LOCAL_REQUIRED
  {
    const ps1Game: Game = {
      id: 'g_ps1_2',
      title: 'Crash Bandicoot',
      slug: 'crash',
      platform: 'PlayStation',
      state: 'CLOUD',
      sizeBytes: 400 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const mockNoRangeProvider: StorageProvider = {
      id: 'no_range',
      name: 'No Range',
      type: 'google_drive',
      supportsRangeReads: false,
      authenticate: async () => ({ success: true, accountId: 'no_range', email: 'test@test.com' }),
      isConnected: async () => true,
      getQuota: async () => ({ totalBytes: 0, usedBytes: 0, freeBytes: 0 }),
      download: async () => ({ success: true, destinationPath: '', bytesWritten: 0, durationMs: 0 } as any),
      listFiles: async () => [],
      getFile: async () => ({} as any),
      getMetadata: async () => ({} as any),
      disconnect: async () => {}
    };
    const res = resolver.resolve({
      game: ps1Game,
      provider: mockNoRangeProvider,
      networkQuality: 'GOOD'
    });
    assert(res.strategy === 'LOCAL_REQUIRED', 'PS1 without range support must fall back to LOCAL_REQUIRED');
    report(5, 'PS1 without Range support falls back to LOCAL_REQUIRED');
  }

  // Scenario 6: PS1 with POOR network quality falls back to LOCAL_REQUIRED
  {
    const ps1Game: Game = {
      id: 'g_ps1_3',
      title: 'Metal Gear Solid',
      slug: 'mgs',
      platform: 'PlayStation',
      state: 'CLOUD',
      sizeBytes: 600 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const mockProvider = new MockRangeStorageProvider();
    const res = resolver.resolve({
      game: ps1Game,
      provider: mockProvider,
      networkQuality: 'POOR'
    });
    assert(res.strategy === 'LOCAL_REQUIRED', 'Poor network must fall back to LOCAL_REQUIRED');
    report(6, 'PS1 with POOR network falls back to LOCAL_REQUIRED');
  }

  // Scenario 7: Heavy platforms (PS2, GameCube, Wii) resolve to LOCAL_REQUIRED
  {
    const ps2Game: Game = {
      id: 'g_ps2',
      title: 'Gran Turismo 4',
      slug: 'gt4',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 4 * 1024 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const gcGame: Game = {
      id: 'g_gc',
      title: 'Super Smash Bros. Melee',
      slug: 'melee',
      platform: 'GameCube',
      state: 'CLOUD',
      sizeBytes: 1.4 * 1024 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    assert(resolver.resolve({ game: ps2Game }).strategy === 'LOCAL_REQUIRED', 'PS2 resolves to LOCAL_REQUIRED');
    assert(resolver.resolve({ game: gcGame }).strategy === 'LOCAL_REQUIRED', 'GameCube resolves to LOCAL_REQUIRED');
    report(7, 'Heavy platforms (PS2, GameCube) resolve to LOCAL_REQUIRED');
  }

  // Scenario 8: User profile explicit always_local overrides candidate to LOCAL_REQUIRED
  {
    const ps1Game: Game = {
      id: 'g_ps1_profile',
      title: 'Spyro the Dragon',
      slug: 'spyro',
      platform: 'PlayStation',
      state: 'CLOUD',
      sizeBytes: 400 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const profile: LaunchProfile = {
      id: 'lp_spyro',
      gameId: ps1Game.id,
      launcherType: 'emulator',
      playbackMode: 'always_local',
      fullscreen: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const mockProvider = new MockRangeStorageProvider();
    const res = resolver.resolve({
      game: ps1Game,
      profile,
      provider: mockProvider,
      networkQuality: 'EXCELLENT'
    });
    assert(res.strategy === 'LOCAL_REQUIRED', 'Profile always_local must force LOCAL_REQUIRED');
    report(8, 'User profile "always_local" overrides candidate to LOCAL_REQUIRED');
  }

  // Scenario 9: Already READY local game resolves immediately to INSTANT_HYDRATION with 0ms
  {
    const readyGame: Game = {
      id: 'g_ready',
      title: 'Ready Game',
      slug: 'ready-game',
      platform: 'PlayStation 2',
      state: 'READY',
      sizeBytes: 2 * 1024 * 1024 * 1024,
      playTimeSeconds: 100,
      installedPath: path.join(TEST_TMP, 'game.iso'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const res = resolver.resolve({ game: readyGame });
    assert(res.strategy === 'INSTANT_HYDRATION', 'Locally READY game is instant');
    assert(res.estimatedHydrationTimeMs === 0, 'Estimated hydration time for READY is 0');
    report(9, 'Locally READY game resolves to INSTANT_HYDRATION with 0ms estimated time');
  }

  // =========================================================================
  // Category 2: RangeReader & Remote Provider (Scenarios 10 - 17)
  // =========================================================================
  console.log('\n--- Category 2: RangeReader & Remote Provider (Scenarios 10 - 17) ---');
  const mockProvider = new MockRangeStorageProvider(8 * 1024 * 1024); // 8 MB fixture
  const rangeReader = new RangeReader({ provider: mockProvider, fileId: 'rem_test_file', expectedFileSize: 8 * 1024 * 1024 });

  // Scenario 10: Valid range read within boundary returns correct slice and byte length
  {
    const result = await rangeReader.readRange(0, 1023);
    assert(result.data.length === 1024, `Expected 1024 bytes, got ${result.data.length}`);
    assert(result.data[0] === 0 && result.data[1] === 1, 'Data bytes should match fixture pattern');
    report(10, 'Valid range read (0-1023) returns correct buffer slice and byte length');
  }

  // Scenario 11: Out-of-bounds end offset throws RangeOutOfBoundsError
  {
    let threw = false;
    try {
      await rangeReader.readRange(0, 10 * 1024 * 1024); // Exceeds 8 MB
    } catch (err) {
      if (err instanceof RangeOutOfBoundsError) threw = true;
    }
    assert(threw, 'Should throw RangeOutOfBoundsError for out-of-bounds end');
    report(11, 'Out-of-bounds end offset throws RangeOutOfBoundsError');
  }

  // Scenario 12: Negative start offset throws RangeOutOfBoundsError
  {
    let threw = false;
    try {
      await rangeReader.readRange(-5, 100);
    } catch (err) {
      if (err instanceof RangeOutOfBoundsError) threw = true;
    }
    assert(threw, 'Should throw RangeOutOfBoundsError for negative start offset');
    report(12, 'Negative start offset throws RangeOutOfBoundsError');
  }

  // Scenario 13: Start offset > end offset throws RangeOutOfBoundsError
  {
    let threw = false;
    try {
      await rangeReader.readRange(500, 400);
    } catch (err) {
      if (err instanceof RangeOutOfBoundsError) threw = true;
    }
    assert(threw, 'Should throw RangeOutOfBoundsError when start > end');
    report(13, 'Start offset > end offset throws RangeOutOfBoundsError');
  }

  // Scenario 14: Non-206 partial response from server throws InvalidRangeResponseError
  {
    mockProvider.failNon206 = true;
    let threw = false;
    try {
      await rangeReader.readRange(0, 100);
    } catch (err) {
      if (err instanceof InvalidRangeResponseError) threw = true;
    } finally {
      mockProvider.failNon206 = false;
    }
    assert(threw, 'Should throw InvalidRangeResponseError on non-206 response');
    report(14, 'Non-206 partial response throws InvalidRangeResponseError');
  }

  // Scenario 15: Transient 429 rate limit triggers exponential backoff and succeeds on subsequent try
  {
    mockProvider.failWith429 = true;
    mockProvider.failCount = 2; // Fail twice then succeed
    const res = await rangeReader.readRange(0, 511);
    assert(res.data.length === 512, 'Read should succeed after retry');
    mockProvider.failWith429 = false;
    report(15, 'Transient 429 rate limit retries with backoff and succeeds');
  }

  // Scenario 16: Persistent error exhausts max retries and throws clean error
  {
    mockProvider.failWith429 = true;
    mockProvider.failCount = 10; // Exceeds default max retries (3)
    let threw = false;
    try {
      await rangeReader.readRange(0, 511);
    } catch (err) {
      threw = true;
    } finally {
      mockProvider.failWith429 = false;
      mockProvider.failCount = 0;
    }
    assert(threw, 'Persistent failure should exhaust retries and throw error');
    report(16, 'Persistent rate limits exhaust retries and throw clean error');
  }

  // Scenario 17: AbortSignal cancels in-flight range request immediately
  {
    const abortController = new AbortController();
    abortController.abort();
    let threw = false;
    try {
      await rangeReader.readRange(0, 1024, abortController.signal);
    } catch (err) {
      if (err instanceof DownloadCancelledError) threw = true;
    }
    assert(threw, 'Aborted signal should immediately throw DownloadCancelledError');
    report(17, 'AbortSignal cancels in-flight range request immediately');
  }

  // =========================================================================
  // Category 3: BlockCache (Scenarios 18 - 27)
  // =========================================================================
  console.log('\n--- Category 3: BlockCache (Scenarios 18 - 27) ---');
  const cacheGameDir = path.join(TEST_TMP, 'game_cache_1');
  const blockCacheProvider = new MockRangeStorageProvider(12 * 1024 * 1024); // 12 MB fixture = 3 blocks of 4 MB
  const blockCacheReader = new RangeReader({ provider: blockCacheProvider, fileId: 'rem_block_file', expectedFileSize: 12 * 1024 * 1024 });
  const blockCache = new BlockCache({
    fileDir: cacheGameDir,
    fileId: 'f_1',
    remoteFileId: 'rem_block_file',
    accountId: 'acc_1',
    expectedSize: 12 * 1024 * 1024,
    remoteVersion: 'v1',
    rangeReader: blockCacheReader
  });

  // Scenario 18: Block size is standard 4 MB (4,194,304 bytes) and block count is 3
  {
    assert(blockCache.blockSize === 4 * 1024 * 1024, 'Block size must be exactly 4 MB');
    assert(blockCache.blockCount === 3, '12 MB file should have exactly 3 blocks');
    report(18, 'Block size is standard 4 MB (4,194,304 bytes) with correct blockCount');
  }

  // Scenario 19: First read of block 0 fetches from provider and creates .blk file + manifest
  {
    const block0 = await blockCache.getBlock(0);
    assert(block0.length === 4 * 1024 * 1024, 'Block 0 must be 4 MB');
    assert(blockCache.isBlockCached(0), 'Block 0 should now be marked as cached on disk');
    const manifest = blockCache.getManifest();
    assert(manifest.cachedBlocks.includes(0), 'Manifest cachedBlocks should include 0');
    report(19, 'First read fetches block 0, writes .blk file, and updates manifest.json');
  }

  // Scenario 20: Second read of block 0 hits local disk cache (no network fetch)
  {
    const initialCallCount = blockCacheProvider.rangeReadCallCount;
    const block0Again = await blockCache.getBlock(0);
    assert(block0Again.length === 4 * 1024 * 1024, 'Cached block 0 length matches');
    assert(blockCacheProvider.rangeReadCallCount === initialCallCount, 'Provider call count should not increase on cache hit');
    const stats = blockCache.getCacheStats();
    assert(stats.hits > 0, 'Cache hits should be recorded');
    report(20, 'Second read of block 0 hits disk cache without network fetch');
  }

  // Scenario 21: In-flight deduplication: concurrent requests for block 1 return single fetch
  {
    const initialCalls = blockCacheProvider.rangeReadCallCount;
    const [p1, p2, p3] = await Promise.all([
      blockCache.getBlock(1),
      blockCache.getBlock(1),
      blockCache.getBlock(1)
    ]);
    assert(p1.length === 4 * 1024 * 1024 && p2.length === p1.length && p3.length === p1.length, 'Concurrent fetch result matches');
    assert(blockCacheProvider.rangeReadCallCount === initialCalls + 1, 'In-flight requests must deduplicate into 1 network call');
    report(21, 'Concurrent requests for block 1 deduplicate into a single network call');
  }

  // Scenario 22: Multi-block span read stitches byte slices correctly across boundaries
  {
    // Read bytes across block 0 and block 1 (from 4MB - 100 bytes to 4MB + 100 bytes = 201 bytes)
    const boundaryStart = 4 * 1024 * 1024 - 100;
    const boundaryEnd = 4 * 1024 * 1024 + 100;
    const slice = await blockCache.readRange(boundaryStart, boundaryEnd);
    assert(slice.length === 201, `Span should be 201 bytes, got ${slice.length}`);
    assert(slice[0] === blockCacheProvider.mockData[boundaryStart], 'Byte slice starts accurately');
    assert(slice[200] === blockCacheProvider.mockData[boundaryEnd], 'Byte slice ends accurately');
    report(22, 'Multi-block span read stitches byte slices correctly across block boundaries');
  }

  // Scenario 23: Locked/active blocks are protected from LRU eviction
  {
    blockCache.lockBlock(0);
    const freed = blockCache.evictLruBlocks(4 * 1024 * 1024);
    assert(freed >= 0 && blockCache.isBlockCached(0), 'Locked block 0 must remain cached');
    blockCache.unlockBlock(0);
    report(23, 'Locked active blocks are protected from LRU eviction');
  }

  // Scenario 24: Inactive blocks are evicted using LRU when cache limit is exceeded
  {
    // Block 0 is unlocked, block 1 is cached. Evict 4 MB.
    const freed = blockCache.evictLruBlocks(4 * 1024 * 1024);
    assert(freed > 0, 'Eviction should free at least 1 block');
    report(24, 'Inactive blocks are evicted using LRU policy');
  }

  // Scenario 25: Version invalidation detects remote update and invalidates old cache
  {
    const cacheGameDir2 = path.join(TEST_TMP, 'game_cache_2');
    fs.mkdirSync(cacheGameDir2, { recursive: true });
    // Write an old manifest with version v1
    fs.writeFileSync(
      path.join(cacheGameDir2, 'manifest.json'),
      JSON.stringify({ remoteVersion: 'v1_old', cachedBlocks: [0, 1] })
    );
    const newCache = new BlockCache({
      fileDir: cacheGameDir2,
      fileId: 'f_v2',
      remoteFileId: 'rem_v2',
      accountId: 'acc_1',
      expectedSize: 8 * 1024 * 1024,
      remoteVersion: 'v2_new',
      rangeReader: blockCacheReader
    });
    assert(newCache.getCachedBlocksCount() === 0, 'Cache should invalidate on version mismatch');
    report(25, 'Cache version mismatch invalidates cached blocks and resets manifest');
  }

  // Scenario 26: materializeFile() sequentially concatenates blocks into final ROM file
  {
    const materializeDir = path.join(TEST_TMP, 'game_cache_mat');
    const matProvider = new MockRangeStorageProvider(8 * 1024 * 1024); // 2 blocks
    const matReader = new RangeReader({ provider: matProvider, fileId: 'rem_mat', expectedFileSize: 8 * 1024 * 1024 });
    const matCache = new BlockCache({
      fileDir: materializeDir,
      fileId: 'f_mat',
      remoteFileId: 'rem_mat',
      accountId: 'acc_1',
      expectedSize: 8 * 1024 * 1024,
      remoteVersion: 'v1',
      rangeReader: matReader
    });
    // Cache all blocks
    await matCache.getBlock(0);
    await matCache.getBlock(1);
    assert(matCache.isFullyCached(), 'All blocks must be cached');
    const finalRomPath = path.join(materializeDir, 'game.rom');
    const materialized = await matCache.materializeFile(finalRomPath);
    assert(materialized === true, 'Materialize should return true');
    assert(fs.existsSync(finalRomPath), 'Final ROM file must exist');
    assert(fs.statSync(finalRomPath).size === 8 * 1024 * 1024, 'Final ROM file size matches expected size');
    report(26, 'materializeFile() concatenates blocks into final monolithic ROM file');
  }

  // Scenario 27: purgeAllBlocks() removes on-disk blocks and resets manifest
  {
    blockCache.purgeAllBlocks();
    assert(blockCache.getCachedBlocksCount() === 0, 'Cached blocks count should be 0 after purge');
    report(27, 'purgeAllBlocks() clears all .blk files and resets manifest');
  }

  // =========================================================================
  // Category 4: PrefetchCoordinator (Scenarios 28 - 32)
  // =========================================================================
  console.log('\n--- Category 4: PrefetchCoordinator (Scenarios 28 - 32) ---');
  const prefetchDir = path.join(TEST_TMP, 'game_cache_prefetch');
  const prefetchProvider = new MockRangeStorageProvider(24 * 1024 * 1024); // 6 blocks
  const prefetchReader = new RangeReader({ provider: prefetchProvider, fileId: 'rem_pref', expectedFileSize: 24 * 1024 * 1024 });
  const prefetchCache = new BlockCache({
    fileDir: prefetchDir,
    fileId: 'f_pref',
    remoteFileId: 'rem_pref',
    accountId: 'acc_1',
    expectedSize: 24 * 1024 * 1024,
    remoteVersion: 'v1',
    rangeReader: prefetchReader
  });
  const coordinator = new PrefetchCoordinator(prefetchCache, { baseReadAheadBlocks: 2, maxReadAheadBlocks: 4 });

  // Scenario 28: Sequential access (block 0) triggers prefetching of block 1 and 2
  {
    coordinator.onBlockRequested(0);
    // Give async prefetch tasks a moment to complete
    await new Promise((r) => setTimeout(r, 100));
    assert(prefetchCache.isBlockCached(1), 'Prefetch should have fetched block 1');
    assert(prefetchCache.isBlockCached(2), 'Prefetch should have fetched block 2');
    report(28, 'Requesting block 0 triggers prefetching of block 1 and 2 (read-ahead)');
  }

  // Scenario 29: Continuous sequential forward reads expand read-ahead window adaptively
  {
    coordinator.onBlockRequested(1);
    coordinator.onBlockRequested(2);
    assert(coordinator.getCurrentWindow() > 2, 'Sequential forward reads should expand read-ahead window');
    report(29, 'Sequential forward reads expand read-ahead window adaptively');
  }

  // Scenario 30: Non-sequential jump resets read-ahead window to baseline
  {
    coordinator.onBlockRequested(5); // Jump ahead to block 5
    assert(coordinator.getCurrentWindow() === 2, 'Non-sequential jump should reset window to baseline');
    report(30, 'Non-sequential jump resets read-ahead window to baseline');
  }

  // Scenario 31: High-priority on-demand requests preempt background prefetch tasks
  {
    coordinator.schedulePrefetch(4, 'BACKGROUND');
    coordinator.schedulePrefetch(3, 'REQUESTED');
    const queue = coordinator.getQueueSnapshot();
    assert(queue.length > 0 && queue[0].blockIndex === 3, 'Priority REQUESTED must be at the head of queue');
    report(31, 'High-priority on-demand requests preempt background prefetch tasks');
  }

  // Scenario 32: Bandwidth throttling: low throughput throttles prefetch window
  {
    coordinator.setNetworkQuality('POOR');
    assert(coordinator.getCurrentWindow() <= 2, 'Poor network must throttle prefetch window');
    coordinator.setNetworkQuality('EXCELLENT');
    report(32, 'Network quality changes throttle or expand prefetch window');
  }

  // =========================================================================
  // Category 5: NetworkCapabilityEstimator (Scenarios 33 - 36)
  // =========================================================================
  console.log('\n--- Category 5: NetworkCapabilityEstimator (Scenarios 33 - 36) ---');
  const estimator = new NetworkCapabilityEstimator();

  // Scenario 33: Records latency and throughput samples accurately
  {
    estimator.recordSample(1024 * 1024, 100); // 1 MB in 100ms = 10 MB/s
    const metrics = estimator.getMetrics();
    assert(metrics.throughputBps > 0, 'Throughput must be greater than zero');
    assert(metrics.averageLatencyMs > 0, 'Average latency must be greater than zero');
    report(33, 'Network estimator records latency and throughput samples');
  }

  // Scenario 34: High throughput (> 10 MB/s) classified as EXCELLENT
  {
    estimator.reset();
    for (let i = 0; i < 5; i++) {
      estimator.recordSample(2 * 1024 * 1024, 100); // 20 MB/s
    }
    assert(estimator.getQuality() === 'EXCELLENT', `Expected EXCELLENT, got ${estimator.getQuality()}`);
    report(34, 'Bandwidth > 10 MB/s classified as EXCELLENT');
  }

  // Scenario 35: Medium throughput (2-10 MB/s) classified as GOOD, (500KB-2MB/s) as FAIR
  {
    estimator.reset();
    for (let i = 0; i < 5; i++) {
      estimator.recordSample(500 * 1024, 100); // 5 MB/s
    }
    assert(estimator.getQuality() === 'GOOD', `Expected GOOD, got ${estimator.getQuality()}`);

    estimator.reset();
    for (let i = 0; i < 5; i++) {
      estimator.recordSample(100 * 1024, 100); // 1 MB/s
    }
    assert(estimator.getQuality() === 'FAIR', `Expected FAIR, got ${estimator.getQuality()}`);
    report(35, 'Throughput 5 MB/s classified as GOOD; 1 MB/s classified as FAIR');
  }

  // Scenario 36: Low throughput (< 500 KB/s) classified as POOR with dynamic adaptation
  {
    estimator.reset();
    for (let i = 0; i < 5; i++) {
      estimator.recordSample(20 * 1024, 100); // 200 KB/s
    }
    assert(estimator.getQuality() === 'POOR', `Expected POOR, got ${estimator.getQuality()}`);
    report(36, 'Throughput < 500 KB/s classified as POOR');
  }

  // =========================================================================
  // Category 6: LocalhostStreamServer (Scenarios 37 - 40)
  // =========================================================================
  console.log('\n--- Category 6: LocalhostStreamServer (Scenarios 37 - 40) ---');
  const serverCacheDir = path.join(TEST_TMP, 'game_cache_server');
  const serverProvider = new MockRangeStorageProvider(8 * 1024 * 1024);
  const serverReader = new RangeReader({ provider: serverProvider, fileId: 'rem_server', expectedFileSize: 8 * 1024 * 1024 });
  const serverCache = new BlockCache({
    fileDir: serverCacheDir,
    fileId: 'f_srv',
    remoteFileId: 'rem_srv',
    accountId: 'acc_1',
    expectedSize: 8 * 1024 * 1024,
    remoteVersion: 'v1',
    rangeReader: serverReader
  });

  const streamServer = new LocalhostStreamServer(serverCache, 8 * 1024 * 1024, 'rom.iso');
  const streamUrl = await streamServer.start();

  // Scenario 37: Binds strictly to 127.0.0.1 and allocates ephemeral port
  {
    assert(streamUrl.startsWith('http://127.0.0.1:'), 'Server must bind strictly to 127.0.0.1');
    report(37, 'Stream server binds strictly to 127.0.0.1 loopback on ephemeral port');
  }

  // Scenario 38: Cryptographically random session token security: unauthorized request rejected
  {
    const parsed = new URL(streamUrl);
    const unauthorizedUrl = `http://127.0.0.1:${parsed.port}/session/invalid_unauthorized_token/rom.iso`;
    const res = await httpGet(unauthorizedUrl);
    assert(res.statusCode === 403, `Expected 403 Forbidden without valid token, got ${res.statusCode}`);
    report(38, 'Unauthorized HTTP request without valid session token is rejected with 403');
  }

  // Scenario 39: Serves Range: bytes=0-1023 with HTTP 206 Partial Content and valid Content-Range
  {
    const res = await httpGet(streamUrl, { Range: 'bytes=0-1023' });
    assert(res.statusCode === 206, `Expected 206 Partial Content, got ${res.statusCode}`);
    assert(res.body.length === 1024, `Expected 1024 bytes body, got ${res.body.length}`);
    assert(res.headers['content-range'] === `bytes 0-1023/${8 * 1024 * 1024}`, 'Content-Range header matches');
    report(39, 'Range request (0-1023) responds with 206 Partial Content and valid Content-Range');
  }

  // Scenario 40: Requested range beyond total size returns HTTP 416 Range Not Satisfiable
  {
    const res = await httpGet(streamUrl, { Range: 'bytes=99999999-100000000' });
    assert(res.statusCode === 416, `Expected 416 Range Not Satisfiable, got ${res.statusCode}`);
    await streamServer.stop();
    report(40, 'Out-of-bounds range request responds with 416 Range Not Satisfiable');
  }

  // =========================================================================
  // Category 7: InstantHydrationService & Launcher Integration (Scenario 41)
  // =========================================================================
  console.log('\n--- Category 7: InstantHydrationService & Launcher Integration (Scenario 41) ---');
  {
    const storageManager = StorageManager.getInstance();
    const hydProvider = new MockRangeStorageProvider(2 * 1024 * 1024, 'acc_test'); // 2 MB small retro game
    storageManager.registerProvider(hydProvider);

    db.prepare(`
      INSERT OR IGNORE INTO storage_accounts (id, provider_type, account_name, status, created_at, updated_at)
      VALUES ('acc_test', 'google_drive', 'Test Account', 'ACTIVE', datetime('now'), datetime('now'))
    `).run();

    const hydGame: Game = {
      id: 'g_hyd_1',
      title: 'The Legend of Zelda: A Link to the Past',
      slug: 'alttp',
      platform: 'SNES',
      state: 'CLOUD',
      sizeBytes: 2 * 1024 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    gamesRepo.upsert(hydGame);

    const hydFile: GameFile = {
      id: 'gf_hyd_1',
      gameId: hydGame.id,
      storageAccountId: 'acc_test',
      remoteFileId: 'rem_alttp',
      remotePath: '/SNES/alttp.sfc',
      filename: 'alttp.sfc',
      sizeBytes: 2 * 1024 * 1024,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    gameFilesRepo.upsert(hydFile);

    const hydService = new InstantHydrationService(
      gamesRepo,
      gameFilesRepo,
      gameManifestsRepo,
      storageManager,
      cacheManager
    );

    const launcher = new LauncherManager(
      gamesRepo,
      gameManifestsRepo,
      launchProfilesRepo,
      emulatorsRepo,
      gameSessionsRepo,
      cacheManager,
      undefined,
      hydService,
      resolver,
      gameFilesRepo,
      storageManager
    );

    // Verify strategy
    const strat = await launcher.getPlaybackStrategy(hydGame.id);
    assert(strat.strategy === 'INSTANT_HYDRATION', 'Strategy should be INSTANT_HYDRATION');

    // Execute hydration directly
    const hydratedGame = await hydService.hydrateGame(hydGame.id);
    assert(hydratedGame.state === 'READY', 'Game state must update to READY after hydration');
    assert(hydratedGame.installedPath !== undefined && fs.existsSync(hydratedGame.installedPath), 'Installed path must exist on disk');

    const manifest = gameManifestsRepo.get(hydGame.id);
    assert(manifest !== null, 'Manifest must be generated in repository');
    assert(manifest.primaryExecutableOrRom === 'alttp.sfc', 'Manifest primaryExecutableOrRom matches');

    report(41, 'InstantHydrationService hydrates small retro ROM, writes manifest, and transitions game to READY');
  }

  console.log('\n====================================================');
  console.log(`  ALL ${passed}/${total} PHASE 4C TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runPhase4CTests().catch((err) => {
  console.error('\n❌ PHASE 4C TEST FAILURE:', err);
  process.exit(1);
});
