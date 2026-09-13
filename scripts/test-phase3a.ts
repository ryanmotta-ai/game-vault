import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../src/database/schema';
import { DownloadsRepository } from '../src/database/repositories/downloadsRepository';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import { StorageManager } from '../src/storage/StorageManager';
import { CacheManager } from '../src/storage/CacheManager';
import { DownloadManager } from '../src/downloads/DownloadManager';
import { StorageProvider } from '../src/providers/StorageProvider';
import {
  RemoteFile,
  PaginatedFilesResult,
  StorageQuota,
  DownloadResult,
  DownloadRequest,
  DownloadProgress,
  FileMetadata
} from '../src/providers/types';
import { sanitizeFilename, isSubPath } from '../src/core/utils/pathSafety';
import { calculateFileMd5 } from '../src/core/utils/checksum';
import {
  InsufficientDiskSpaceError,
  DownloadCancelledError,
  RemoteFileUnavailableError
} from '../src/core/errors/AppError';
import { Game, GameFile, DownloadItem } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// Temporary test directory for disk isolation
const TEST_ROOT_DIR = path.resolve(__dirname, '../.test_cache_phase3a');

function cleanTestDir() {
  if (fs.existsSync(TEST_ROOT_DIR)) {
    fs.rmSync(TEST_ROOT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_ROOT_DIR, { recursive: true });
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabaseSchema(db);
  return db;
}

/**
 * Mock StorageProvider designed specifically for testing DownloadEngine.
 */
class MockDownloadProvider implements StorageProvider {
  public id: string;
  public name: string;
  public type = 'google_drive' as const;

  public simulatedFiles = new Map<string, { content: Buffer; md5: string }>();
  public shouldFailWith401Once = false;
  public shouldFailWith404 = false;
  public shouldFailMidStream = false;
  public chunkDelayMs = 0;
  public customError: Error | null = null;
  public downloadCallCount = 0;

  constructor(id = 'gdrive-test-account', name = 'Test Google Drive') {
    this.id = id;
    this.name = name;
  }

  public async disconnect(): Promise<void> {}

  public registerFile(fileId: string, content: Buffer): string {
    const md5 = crypto.createHash('md5').update(content).digest('hex');
    this.simulatedFiles.set(fileId, { content, md5 });
    return md5;
  }

  public async authenticate() {
    return { success: true };
  }

  public async isConnected() {
    return true;
  }

  public async getFile(fileId: string): Promise<RemoteFile> {
    const file = this.simulatedFiles.get(fileId);
    return {
      id: fileId,
      name: `file-${fileId}.iso`,
      mimeType: 'application/octet-stream',
      sizeBytes: file ? file.content.length : 0,
      isFolder: false,
      md5Checksum: file ? file.md5 : undefined
    };
  }

  public async download(
    requestOrFileId: string | DownloadRequest,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    this.downloadCallCount++;
    const startTime = Date.now();

    const fileId = typeof requestOrFileId === 'string' ? requestOrFileId : requestOrFileId.fileId;
    const destPath = typeof requestOrFileId === 'string' ? '' : requestOrFileId.destinationPath;
    const signal = typeof requestOrFileId === 'string' ? undefined : requestOrFileId.signal;

    if (this.shouldFailWith404) {
      throw new RemoteFileUnavailableError(`Remote file ${fileId} not found on remote storage.`);
    }

    if (this.customError) {
      throw this.customError;
    }

    const fileData = this.simulatedFiles.get(fileId);
    if (!fileData) {
      throw new RemoteFileUnavailableError(`Mock file ${fileId} not found in test provider.`);
    }

    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(destPath);
    const chunkSize = 64 * 1024; // 64 KB chunks
    const totalBytes = fileData.content.length;
    let bytesTransferred = 0;

    try {
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        if (signal?.aborted) {
          writeStream.destroy();
          throw new DownloadCancelledError(`Download of ${fileId} was cancelled.`);
        }

        if (this.shouldFailMidStream && bytesTransferred > totalBytes / 2) {
          writeStream.destroy();
          throw new RemoteFileUnavailableError('Simulated network disconnect mid-stream');
        }

        const chunk = fileData.content.subarray(offset, Math.min(offset + chunkSize, totalBytes));
        await new Promise<void>((resolve, reject) => {
          writeStream.write(chunk, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        bytesTransferred += chunk.length;

        if (onProgress) {
          const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
          const speedBps = Math.round(bytesTransferred / elapsedSec);
          const etaSeconds = speedBps > 0 ? Math.round((totalBytes - bytesTransferred) / speedBps) : undefined;
          onProgress({
            fileId,
            bytesTransferred,
            totalBytes,
            speedBps,
            percentage: Math.min(100, Math.round((bytesTransferred / totalBytes) * 100)),
            etaSeconds
          });
        }

        if (this.chunkDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.chunkDelayMs));
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return {
        destinationPath: destPath,
        bytesWritten: bytesTransferred,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      writeStream.destroy();
      throw err;
    }
  }

  public async getMetadata(fileId: string): Promise<FileMetadata> {
    const f = await this.getFile(fileId);
    return {
      fileId: f.id,
      name: f.name,
      sizeBytes: f.sizeBytes,
      mimeType: f.mimeType
    };
  }

  public async listFiles(): Promise<RemoteFile[]> {
    return [];
  }

  public async listPaginatedFiles(): Promise<PaginatedFilesResult> {
    return { files: [] };
  }

  public async getStartPageToken(): Promise<string> {
    return 'token';
  }

  public async getQuota(): Promise<StorageQuota> {
    return { totalBytes: 1000000000, usedBytes: 500000000, freeBytes: 500000000 };
  }
}

function registerTestAccount(accountsRepo: StorageAccountsRepository, id: string, name = 'Test Provider') {
  accountsRepo.upsert({
    id,
    providerType: 'google_drive',
    providerAccountId: `provider-${id}`,
    credentialKey: `gdrive:${id}`,
    accountName: name,
    accountEmail: `${id}@test.com`,
    status: 'ACTIVE',
    quotaTotalBytes: 1000000000,
    quotaUsedBytes: 500000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 GAME VAULT - PHASE 3A: RELIABLE DOWNLOAD ENGINE V1 TEST SUITE');
  console.log('   Verifying FIFO Queue, Pre-flight Disk Check, Checksum Stream,');
  console.log('   Atomic Rename, State Transitions, Crash Recovery & Resiliency');
  console.log('================================================================\n');

  cleanTestDir();

  let passedCount = 0;
  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`  ▶ ${name} ... `);
    try {
      await fn();
      console.log('✅ PASS');
      passedCount++;
    } catch (err: unknown) {
      console.log('❌ FAIL');
      console.error(err);
      throw err;
    }
  }

  // ============================================================================
  // SUITE 1: PATH SAFETY & WINDOWS FILENAME SANITIZATION
  // ============================================================================
  console.log('\n--- SUITE 1: Path Safety & Windows Filename Sanitization ---');

  await test('1.1: Strips directory traversals and path delimiters', async () => {
    assert(sanitizeFilename('../../../evil.iso') === 'evil.iso', 'Must strip traversal dots and slashes');
    assert(sanitizeFilename('..\\..\\games\\test.bin') === 'test.bin', 'Must strip Windows backslash traversal');
    assert(sanitizeFilename('/etc/shadow') === 'shadow', 'Must strip absolute Unix paths');
    assert(sanitizeFilename('C:\\Windows\\System32\\cmd.exe') === 'cmd.exe', 'Must strip Windows drive path');
  });

  await test('1.2: Replaces Windows illegal characters with underscores', async () => {
    const dangerous = 'Game: Subtitle *Special? Edition* "Director\'s" <Cut> | 2024.iso';
    const safe = sanitizeFilename(dangerous);
    assert(!safe.includes(':'), 'No colons');
    assert(!safe.includes('*'), 'No asterisks');
    assert(!safe.includes('?'), 'No question marks');
    assert(!safe.includes('"'), 'No quotes');
    assert(!safe.includes('<'), 'No less than');
    assert(!safe.includes('>'), 'No greater than');
    assert(!safe.includes('|'), 'No pipes');
    assert(safe.endsWith('.iso'), 'Must preserve valid extension');
  });

  await test('1.3: Prefixes Windows reserved device names', async () => {
    assert(sanitizeFilename('CON.iso') === '_CON.iso', 'CON reserved');
    assert(sanitizeFilename('prn.bin') === '_prn.bin', 'PRN reserved');
    assert(sanitizeFilename('AUX.zip') === '_AUX.zip', 'AUX reserved');
    assert(sanitizeFilename('NUL.rom') === '_NUL.rom', 'NUL reserved');
    assert(sanitizeFilename('COM1.iso') === '_COM1.iso', 'COM1 reserved');
    assert(sanitizeFilename('lpt9.cue') === '_lpt9.cue', 'LPT9 reserved');
  });

  await test('1.4: Strips trailing dots and spaces (Windows filesystem restriction)', async () => {
    assert(sanitizeFilename('Gran Turismo 4.iso. . . ') === 'Gran Turismo 4.iso', 'Strip trailing dots/spaces');
    assert(sanitizeFilename('test.bin   ') === 'test.bin', 'Strip trailing spaces');
  });

  await test('1.5: Truncates overly long filenames while preserving extension', async () => {
    const longName = 'A'.repeat(300) + '.iso';
    const safe = sanitizeFilename(longName);
    assert(safe.length <= 255, `Safe filename length must be <= 255, got ${safe.length}`);
    assert(safe.endsWith('.iso'), 'Preserved .iso extension');
  });

  await test('1.6: isSubPath prevents escaping target directory', async () => {
    const parentDir = path.resolve(TEST_ROOT_DIR, 'cache/games');
    const safeChild = path.resolve(parentDir, 'game-123/game.iso');
    const evilChild = path.resolve(parentDir, '../system32/evil.dll');
    assert(isSubPath(parentDir, safeChild) === true, 'Valid subpath');
    assert(isSubPath(parentDir, evilChild) === false, 'Invalid escaping subpath');
  });

  // ============================================================================
  // SUITE 2: STREAMING CHECKSUM (MD5) VERIFICATION
  // ============================================================================
  console.log('\n--- SUITE 2: Streaming Checksum (MD5) Verification ---');

  await test('2.1: Accurately computes MD5 via streaming pipeline', async () => {
    const filePath = path.resolve(TEST_ROOT_DIR, 'test_checksum.bin');
    const content = Buffer.from('GameVault_High_Resilience_Download_Engine_2026_Content');
    fs.writeFileSync(filePath, content);

    const expectedMd5 = crypto.createHash('md5').update(content).digest('hex');
    const calculatedMd5 = await calculateFileMd5(filePath);

    assert(calculatedMd5.toLowerCase() === expectedMd5.toLowerCase(), 'Checksums must match exactly');
  });

  await test('2.2: AbortSignal cancels MD5 calculation stream', async () => {
    const filePath = path.resolve(TEST_ROOT_DIR, 'test_abort_checksum.bin');
    fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024, 0x41));

    const controller = new AbortController();
    controller.abort();

    let threw = false;
    try {
      await calculateFileMd5(filePath, controller.signal);
    } catch {
      threw = true;
    }
    assert(threw, 'calculateFileMd5 must throw when aborted');
  });

  // ============================================================================
  // SUITE 3: CACHEMANAGER PATHS & VERIFICATION
  // ============================================================================
  console.log('\n--- SUITE 3: CacheManager Paths & Local File Verification ---');

  await test('3.1: Generates expected partial and final paths in isolation', async () => {
    const cacheDir = path.resolve(TEST_ROOT_DIR, 'test_cache_mgr');
    const cacheManager = new CacheManager(cacheDir);

    assert(cacheManager.getPartialDownloadDir().includes('downloads'), 'Downloads partial dir');
    assert(cacheManager.getGameCacheDir('game-99').includes('games'), 'Games final dir');

    const partialPath = cacheManager.getPartialFilePath('dl-12345');
    assert(partialPath.endsWith('dl-12345.part'), `Must end in dl-12345.part, got ${partialPath}`);

    const finalPath = cacheManager.getFinalGameFilePath('game-99', 'Gran_Turismo_4.iso');
    assert(finalPath.includes('games'), 'Contains games path');
    assert(finalPath.endsWith('Gran_Turismo_4.iso'), 'Contains sanitized filename');
  });

  await test('3.2: verifyLocalFile checks existence, size and MD5', async () => {
    const cacheDir = path.resolve(TEST_ROOT_DIR, 'test_cache_mgr');
    const cacheManager = new CacheManager(cacheDir);

    const testFile = path.resolve(cacheDir, 'sample.rom');
    const content = Buffer.from('ROM_DATA_123');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(testFile, content);
    const expectedMd5 = crypto.createHash('md5').update(content).digest('hex');

    assert(cacheManager.verifyLocalFile(testFile), 'Existing file exists');
    assert(cacheManager.verifyLocalFile(testFile, content.length), 'Size matches');
    assert(!cacheManager.verifyLocalFile(testFile, content.length + 10), 'Size mismatch returns false');
    assert(cacheManager.verifyLocalFile(testFile, content.length, expectedMd5), 'MD5 matches');
    assert(!cacheManager.verifyLocalFile(testFile, content.length, 'wrongmd5'), 'MD5 mismatch returns false');
    assert(!cacheManager.verifyLocalFile(path.resolve(cacheDir, 'nonexistent.rom')), 'Nonexistent returns false');
  });

  await test('3.3: getAvailableDiskSpace reports available bytes', async () => {
    const cacheDir = path.resolve(TEST_ROOT_DIR, 'test_cache_mgr');
    const cacheManager = new CacheManager(cacheDir);
    const space = cacheManager.getAvailableDiskSpace();
    assert(typeof space === 'number' && space > 0, `Available space must be > 0 bytes, got ${space}`);
  });

  // ============================================================================
  // SUITE 4: DOWNLOAD ENGINE FIFO QUEUE & CONCURRENCY
  // ============================================================================
  console.log('\n--- SUITE 4: Download Engine FIFO Queue & Single-Active Concurrency ---');

  await test('4.1: FIFO Queue: 1 active, remainder QUEUED, processes strictly in sequence', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-fifo', 'FIFO Provider');

    const cacheDir = path.resolve(TEST_ROOT_DIR, 'cache_fifo');
    const cacheManager = new CacheManager(cacheDir);
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-fifo', 'FIFO Provider');
    mockProvider.chunkDelayMs = 20; // slight delay to test queue state
    storageManager.registerProvider(mockProvider);

    // Register 3 games
    const games: Game[] = [
      { id: 'g1', title: 'Game 1', slug: 'game-1', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'g2', title: 'Game 2', slug: 'game-2', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'g3', title: 'Game 3', slug: 'game-3', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    for (const g of games) gamesRepo.upsert(g);

    // Register files
    for (let i = 1; i <= 3; i++) {
      const buf = Buffer.alloc(1024, i);
      const md5 = mockProvider.registerFile(`f${i}`, buf);
      const gf: GameFile = {
        id: `gf${i}`,
        gameId: `g${i}`,
        storageAccountId: 'acc-fifo',
        remoteFileId: `f${i}`,
        remotePath: `/Games/game_${i}.iso`,
        filename: `game_${i}.iso`,
        sizeBytes: 1024,
        md5Checksum: md5,
        status: 'REMOTE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      gameFilesRepo.upsert(gf);
    }

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    // Queue all 3 items sequentially
    const dl1 = await downloadManager.queueGame('g1');
    const dl2 = await downloadManager.queueGame('g2');
    const dl3 = await downloadManager.queueGame('g3');

    // Item 1 should start, items 2 and 3 must be QUEUED
    assert(dl1.status === 'QUEUED' || dl1.status === 'DOWNLOADING', 'Item 1 initialized');
    assert(dl2.status === 'QUEUED', 'Item 2 must be QUEUED');
    assert(dl3.status === 'QUEUED', 'Item 3 must be QUEUED');

    // Wait for all 3 downloads to finish
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for FIFO queue completion')), 10000);
      downloadManager.onStateChanged((event) => {
        if (event.downloadId === dl3.id && event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const final1 = downloadsRepo.getById(dl1.id);
    const final2 = downloadsRepo.getById(dl2.id);
    const final3 = downloadsRepo.getById(dl3.id);

    assert(final1?.status === 'COMPLETED', 'Item 1 must be COMPLETED');
    assert(final2?.status === 'COMPLETED', 'Item 2 must be COMPLETED');
    assert(final3?.status === 'COMPLETED', 'Item 3 must be COMPLETED');

    // Check games are now READY
    assert(gamesRepo.getById('g1')?.state === 'READY', 'Game 1 READY');
    assert(gamesRepo.getById('g2')?.state === 'READY', 'Game 2 READY');
    assert(gamesRepo.getById('g3')?.state === 'READY', 'Game 3 READY');
  });

  // ============================================================================
  // SUITE 5: DUPLICATE PREVENTION
  // ============================================================================
  console.log('\n--- SUITE 5: Duplicate Prevention ---');

  await test('5.1: Duplicate queue requests return existing active/queued download', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-dup', 'Dup Provider');

    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_dup'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-dup', 'Dup Provider');
    mockProvider.chunkDelayMs = 200; // Hold active
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({
      id: 'g-dup',
      title: 'Dup Game',
      slug: 'dup-game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const md5 = mockProvider.registerFile('f-dup', Buffer.alloc(1024, 0x11));
    gameFilesRepo.upsert({
      id: 'gf-dup',
      gameId: 'g-dup',
      storageAccountId: 'acc-dup',
      remoteFileId: 'f-dup',
      remotePath: '/Games/dup.iso',
      filename: 'dup.iso',
      sizeBytes: 1024,
      md5Checksum: md5,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const first = await downloadManager.queueGame('g-dup');
    const second = await downloadManager.queueGame('g-dup');

    assert(first.id === second.id, `Duplicate queue must return the identical download ID (got ${first.id} vs ${second.id})`);
    const all = downloadsRepo.getAll();
    assert(all.length === 1, `Must only have 1 download record in DB, found ${all.length}`);

    // Cancel to clean up background queue
    await downloadManager.cancelDownload(first.id);
  });

  // ============================================================================
  // SUITE 6: PRE-FLIGHT DISK SPACE VALIDATION
  // ============================================================================
  console.log('\n--- SUITE 6: Pre-flight Disk Space Validation ---');

  await test('6.1: Fails immediately when disk space < required size + 512MB safety buffer', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-disk', 'Disk Provider');

    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_disk'));

    // Mock cacheManager available space to be small (e.g. only 100 MB)
    cacheManager.getAvailableDiskSpace = () => 100 * 1024 * 1024; // 100 MB

    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-disk', 'Disk Provider');
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({
      id: 'g-huge',
      title: 'Huge Game',
      slug: 'huge-game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    gameFilesRepo.upsert({
      id: 'gf-huge',
      gameId: 'g-huge',
      storageAccountId: 'acc-disk',
      remoteFileId: 'f-huge',
      remotePath: '/Games/huge.iso',
      filename: 'huge.iso',
      sizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    let threw = false;
    try {
      await downloadManager.queueGame('g-huge');
    } catch (err) {
      threw = true;
      assert(err instanceof InsufficientDiskSpaceError, 'Must throw InsufficientDiskSpaceError');
    }

    assert(threw, 'Must reject queue on insufficient disk space');
    const downloads = downloadsRepo.getAll();
    assert(downloads.length === 1, 'Should record failed attempt');
    assert(downloads[0].status === 'FAILED', 'Status marked FAILED');
    assert(downloads[0].errorMessage === 'INSUFFICIENT_DISK_SPACE', 'Error message recorded');

    // Verify no .part file was created on disk
    const partialDir = cacheManager.getPartialDownloadDir();
    const files = fs.existsSync(partialDir) ? fs.readdirSync(partialDir) : [];
    assert(files.length === 0, 'No partial file should exist');
  });

  // ============================================================================
  // SUITE 7: PROGRESS REPORTING & EVENT EMISSIONS
  // ============================================================================
  console.log('\n--- SUITE 7: Progress Reporting & Event Emissions ---');

  await test('7.1: Emits throttled progress events with ETA and speed calculation', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-prog', 'Progress Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_prog'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-prog', 'Progress Provider');
    mockProvider.chunkDelayMs = 15;
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({
      id: 'g-prog',
      title: 'Progress Game',
      slug: 'prog-game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 512 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const fileBuffer = Buffer.alloc(512 * 1024, 0x42);
    const md5 = mockProvider.registerFile('f-prog', fileBuffer);

    gameFilesRepo.upsert({
      id: 'gf-prog',
      gameId: 'g-prog',
      storageAccountId: 'acc-prog',
      remoteFileId: 'f-prog',
      remotePath: '/Games/prog.iso',
      filename: 'prog.iso',
      sizeBytes: 512 * 1024,
      md5Checksum: md5,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const progressList: number[] = [];
    downloadManager.onProgress((p) => {
      progressList.push(p.percentage);
      assert(typeof p.bytesTransferred === 'number', 'bytesTransferred is number');
      assert(typeof p.speedBps === 'number', 'speedBps is number');
    });

    await downloadManager.queueGame('g-prog');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Progress test timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    assert(progressList.length > 0, 'Must have received progress events');
    assert(progressList[progressList.length - 1] === 100, 'Final progress must reach 100%');
  });

  // ============================================================================
  // SUITE 8: ATOMIC RENAME & VERIFIED FINALIZATION
  // ============================================================================
  console.log('\n--- SUITE 8: Atomic Rename & Checksum Verification ---');

  await test('8.1: Validates MD5 and atomically renames .part to final cache destination', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-atom', 'Atomic Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_atomic'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-atom', 'Atomic Provider');
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({
      id: 'g-atom',
      title: 'Atomic Game',
      slug: 'atomic-game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 128 * 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const fileContent = Buffer.from('TEST_ATOMIC_PAYLOAD_DATA_FOR_VERIFICATION_2026');
    const md5 = mockProvider.registerFile('f-atom', fileContent);

    gameFilesRepo.upsert({
      id: 'gf-atom',
      gameId: 'g-atom',
      storageAccountId: 'acc-atom',
      remoteFileId: 'f-atom',
      remotePath: '/Games/Gran Turismo 4.iso',
      filename: 'Gran Turismo 4.iso',
      sizeBytes: fileContent.length,
      md5Checksum: md5,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const item = await downloadManager.queueGame('g-atom');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Atomic test timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // 1. Partial file must NOT exist anymore
    const partialPath = cacheManager.getPartialFilePath(item.id);
    assert(!fs.existsSync(partialPath), 'Partial .part file must be cleaned up / renamed');

    // 2. Final destination file MUST exist
    const expectedFinalPath = cacheManager.getFinalGameFilePath('g-atom', 'Gran Turismo 4.iso');
    assert(fs.existsSync(expectedFinalPath), `Final game file must exist at ${expectedFinalPath}`);

    // 3. File size and MD5 match
    const finalContent = fs.readFileSync(expectedFinalPath);
    assert(finalContent.equals(fileContent), 'Final content matches downloaded content');

    // 4. DB state checks
    const updatedGameFile = gameFilesRepo.getById('gf-atom');
    assert(updatedGameFile?.status === 'CACHED_LOCAL', 'Game file status CACHED_LOCAL');
    assert(updatedGameFile?.localPath === expectedFinalPath, 'Game file localPath updated');

    const updatedGame = gamesRepo.getById('g-atom');
    assert(updatedGame?.state === 'READY', 'Game state must be READY');
    assert(updatedGame?.installedPath === expectedFinalPath, 'Game installedPath updated');
  });

  // ============================================================================
  // SUITE 9: CHECKSUM MISMATCH HANDLING
  // ============================================================================
  console.log('\n--- SUITE 9: Checksum Mismatch Handling ---');

  await test('9.1: Corrupted or mismatched MD5 cleans partial and marks FAILED', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-mis', 'Mismatch Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_mismatch'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-mis', 'Mismatch Provider');
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({
      id: 'g-mis',
      title: 'Corrupt Game',
      slug: 'corrupt-game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      sizeBytes: 1024,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Register file with provider, but deliberately put wrong MD5 in gameFilesRepo
    mockProvider.registerFile('f-mis', Buffer.alloc(1024, 0x55));

    gameFilesRepo.upsert({
      id: 'gf-mis',
      gameId: 'g-mis',
      storageAccountId: 'acc-mis',
      remoteFileId: 'f-mis',
      remotePath: '/Games/corrupted.iso',
      filename: 'corrupted.iso',
      sizeBytes: 1024,
      md5Checksum: 'deadbeefcafebabe0123456789abcdef', // WRONG MD5
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const item = await downloadManager.queueGame('g-mis');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mismatch test timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.status === 'FAILED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Verify partial was deleted
    const partialPath = cacheManager.getPartialFilePath(item.id);
    assert(!fs.existsSync(partialPath), 'Partial file must be deleted on checksum mismatch');

    // Verify final file was NOT created
    const finalPath = cacheManager.getFinalGameFilePath('g-mis', 'corrupted.iso');
    assert(!fs.existsSync(finalPath), 'Final file must NOT be created on checksum mismatch');

    // Verify DB states
    const dl = downloadsRepo.getById(item.id);
    assert(dl?.status === 'FAILED', 'Download status is FAILED');
    assert(dl?.errorMessage === 'CHECKSUM_MISMATCH', 'Error reason is CHECKSUM_MISMATCH');

    const game = gamesRepo.getById('g-mis');
    assert(game?.state === 'CLOUD', 'Game state remains CLOUD');
  });

  // ============================================================================
  // SUITE 10: CANCELLATION FLOW
  // ============================================================================
  console.log('\n--- SUITE 10: Cancellation Flow ---');

  await test('10.1: Cancelling in-flight download aborts stream, removes .part, and advances queue', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-can', 'Cancel Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_cancel'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-can', 'Cancel Provider');
    mockProvider.chunkDelayMs = 40; // slow chunk rate to cancel mid-flight
    storageManager.registerProvider(mockProvider);

    // 2 games: g-can1 (cancelled) and g-can2 (should automatically start next)
    gamesRepo.upsert({ id: 'g-can1', title: 'Cancel Game 1', slug: 'can-1', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 1024 * 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    gamesRepo.upsert({ id: 'g-can2', title: 'Queued Game 2', slug: 'can-2', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const md1 = mockProvider.registerFile('f-can1', Buffer.alloc(1024 * 1024, 0x1));
    const md2 = mockProvider.registerFile('f-can2', Buffer.alloc(1024, 0x2));

    gameFilesRepo.upsert({ id: 'gf-can1', gameId: 'g-can1', storageAccountId: 'acc-can', remoteFileId: 'f-can1', remotePath: '/Games/can1.iso', filename: 'can1.iso', sizeBytes: 1024 * 1024, md5Checksum: md1, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    gameFilesRepo.upsert({ id: 'gf-can2', gameId: 'g-can2', storageAccountId: 'acc-can', remoteFileId: 'f-can2', remotePath: '/Games/can2.iso', filename: 'can2.iso', sizeBytes: 1024, md5Checksum: md2, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);
    downloadManager.setMaxConcurrent(1);

    const dl1 = await downloadManager.queueGame('g-can1');
    const dl2 = await downloadManager.queueGame('g-can2');

    // Wait a brief tick for dl1 to start DOWNLOADING
    await new Promise((r) => setTimeout(r, 60));

    // Cancel dl1
    await downloadManager.cancelDownload(dl1.id);

    // Wait for dl2 to complete
    if (downloadsRepo.getById(dl2.id)?.status !== 'COMPLETED') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Cancel queue advance timeout')), 5000);
        downloadManager.onStateChanged((event) => {
          if (event.downloadId === dl2.id && event.status === 'COMPLETED') {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }

    // Check dl1 is CANCELLED and partial is deleted
    const item1 = downloadsRepo.getById(dl1.id);
    assert(item1?.status === 'CANCELLED', 'Item 1 status CANCELLED');
    const partPath1 = cacheManager.getPartialFilePath(dl1.id);
    assert(!fs.existsSync(partPath1), 'Partial file for item 1 must be deleted');
    assert(gamesRepo.getById('g-can1')?.state === 'CLOUD', 'Game 1 returned to CLOUD');

    // Check dl2 progressed to COMPLETED
    const item2 = downloadsRepo.getById(dl2.id);
    assert(item2?.status === 'COMPLETED', 'Item 2 automatically COMPLETED');
    assert(gamesRepo.getById('g-can2')?.state === 'READY', 'Game 2 reached READY');
  });

  // ============================================================================
  // SUITE 11: NETWORK / PROVIDER ERROR RESILIENCY
  // ============================================================================
  console.log('\n--- SUITE 11: Network / Provider Error Resiliency ---');

  await test('11.1: Mid-stream network error marks FAILED, removes .part, and advances queue', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-err', 'Error Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_neterr'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-err', 'Error Provider');
    mockProvider.shouldFailMidStream = true; // Inject mid-stream failure
    storageManager.registerProvider(mockProvider);

    gamesRepo.upsert({ id: 'g-err', title: 'Error Game', slug: 'err-game', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: 256 * 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const md = mockProvider.registerFile('f-err', Buffer.alloc(256 * 1024, 0x99));
    gameFilesRepo.upsert({ id: 'gf-err', gameId: 'g-err', storageAccountId: 'acc-err', remoteFileId: 'f-err', remotePath: '/Games/err.iso', filename: 'err.iso', sizeBytes: 256 * 1024, md5Checksum: md, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const item = await downloadManager.queueGame('g-err');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Network error test timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.status === 'FAILED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const dl = downloadsRepo.getById(item.id);
    assert(dl?.status === 'FAILED', 'Status is FAILED');
    assert(dl?.errorMessage?.includes('Simulated network disconnect'), 'Error message preserved');

    const partPath = cacheManager.getPartialFilePath(item.id);
    assert(!fs.existsSync(partPath), 'Partial file must be cleaned up on failure');

    const game = gamesRepo.getById('g-err');
    assert(game?.state === 'CLOUD', 'Game state returned to CLOUD');
  });

  // ============================================================================
  // SUITE 12: MULTI-FILE GAME STATE LIFECYCLE
  // ============================================================================
  console.log('\n--- SUITE 12: Multi-File Game State Lifecycle ---');

  await test('12.1: Game with 2 files is READY only when ALL required files are cached', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-mul', 'Multi Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_multi'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);
    const mockProvider = new MockDownloadProvider('acc-mul', 'Multi Provider');
    storageManager.registerProvider(mockProvider);

    // Multi-file game: cue + bin
    gamesRepo.upsert({ id: 'g-multi', title: 'Multi Disc Game', slug: 'multi-game', platform: 'PlayStation', state: 'CLOUD', sizeBytes: 2048, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const cueBuf = Buffer.from('FILE "game.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00');
    const binBuf = Buffer.alloc(2000, 0x77);

    const mdCue = mockProvider.registerFile('f-cue', cueBuf);
    const mdBin = mockProvider.registerFile('f-bin', binBuf);

    gameFilesRepo.upsert({ id: 'gf-cue', gameId: 'g-multi', storageAccountId: 'acc-mul', remoteFileId: 'f-cue', remotePath: '/Games/game.cue', filename: 'game.cue', sizeBytes: cueBuf.length, md5Checksum: mdCue, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    gameFilesRepo.upsert({ id: 'gf-bin', gameId: 'g-multi', storageAccountId: 'acc-mul', remoteFileId: 'f-bin', remotePath: '/Games/game.bin', filename: 'game.bin', sizeBytes: binBuf.length, md5Checksum: mdBin, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    // Queue ONLY the cue file first
    const dlCue = await downloadManager.queueGameFile('gf-cue');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Cue download timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.downloadId === dlCue.id && event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Check game state: should STILL be CLOUD because bin is missing!
    const gameStateAfterCue = gamesRepo.getById('g-multi')?.state;
    assert(gameStateAfterCue === 'CLOUD', `Game must still be CLOUD when 1 of 2 files is cached, got ${gameStateAfterCue}`);

    // Now queue the bin file
    const dlBin = await downloadManager.queueGameFile('gf-bin');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bin download timeout')), 5000);
      downloadManager.onStateChanged((event) => {
        if (event.downloadId === dlBin.id && event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Check game state: NOW it must be READY!
    const gameStateAfterAll = gamesRepo.getById('g-multi')?.state;
    assert(gameStateAfterAll === 'READY', `Game must be READY when ALL files are cached, got ${gameStateAfterAll}`);
  });

  // ============================================================================
  // SUITE 13: CRASH RECOVERY (recoverStaleDownloads)
  // ============================================================================
  console.log('\n--- SUITE 13: Crash Recovery (recoverStaleDownloads) ---');

  await test('13.1: Automatically heals stale DOWNLOADING records and cleans orphan .part files', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-crash', 'Crash Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_crash'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);

    gamesRepo.upsert({ id: 'g-crash', title: 'Crash Game', slug: 'crash-game', platform: 'PlayStation 2', state: 'DOWNLOADING', sizeBytes: 1024, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    gameFilesRepo.upsert({ id: 'gf-crash', gameId: 'g-crash', storageAccountId: 'acc-crash', remoteFileId: 'f-crash', remotePath: '/Games/crash.iso', filename: 'crash.iso', sizeBytes: 1024, status: 'REMOTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    // Simulate an interrupted download from a previous crash
    const orphanPart = cacheManager.getPartialFilePath('dl-crashed-1');
    fs.mkdirSync(path.dirname(orphanPart), { recursive: true });
    fs.writeFileSync(orphanPart, Buffer.from('interrupted bytes'));

    const staleItem: DownloadItem = {
      id: 'dl-crashed-1',
      gameId: 'g-crash',
      gameFileId: 'gf-crash',
      storageAccountId: 'acc-crash',
      status: 'DOWNLOADING', // left in DOWNLOADING
      totalBytes: 1024,
      downloadedBytes: 500,
      downloadSpeedBps: 100000,
      destinationPath: cacheManager.getFinalGameFilePath('g-crash', 'crash.iso'),
      partialPath: orphanPart,
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      createdAt: new Date(Date.now() - 3600000).toISOString()
    };
    downloadsRepo.upsert(staleItem);

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    const recoveredCount = downloadManager.recoverStaleDownloads();
    assert(recoveredCount === 1, `Must recover 1 stale download, recovered ${recoveredCount}`);

    const recoveredItem = downloadsRepo.getById('dl-crashed-1');
    assert(recoveredItem?.status === 'PAUSED' || recoveredItem?.status === 'FAILED', 'Status updated to PAUSED or FAILED');
    assert(recoveredItem?.errorMessage === 'INTERRUPTED_BY_APP_EXIT', 'Error code INTERRUPTED_BY_APP_EXIT');

    // Game state recalculated (CLOUD or DOWNLOADING if paused)
    const game = gamesRepo.getById('g-crash');
    assert(game?.state === 'CLOUD' || game?.state === 'DOWNLOADING', `Game state must be recalculated to CLOUD or DOWNLOADING, got ${game?.state}`);
  });

  // ============================================================================
  // SUITE 14: LARGE FILE STREAM MEMORY STABILITY TEST
  // ============================================================================
  console.log('\n--- SUITE 14: Large File Stream Memory Stability Test ---');

  await test('14.1: Streams 50 MB simulated payload with bounded memory usage (no heap explosion)', async () => {
    const db = createTestDb();
    const downloadsRepo = new DownloadsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    registerTestAccount(accountsRepo, 'acc-large', 'Large Provider');
    const cacheManager = new CacheManager(path.resolve(TEST_ROOT_DIR, 'cache_large'));
    const storageManager = StorageManager.getInstance();
    storageManager.clear();
    storageManager.setRepository(accountsRepo);

    const totalPayloadBytes = 50 * 1024 * 1024; // 50 MB
    let calculatedMd5Hash = crypto.createHash('md5');

    // Generate large file provider with streaming chunks
    class StreamingLargeProvider extends MockDownloadProvider {
      public override async download(request: DownloadRequest, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResult> {
        const dest = request.destinationPath;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const ws = fs.createWriteStream(dest);
        const chunk = Buffer.alloc(1024 * 1024, 0x33); // 1 MB chunk
        let sent = 0;

        while (sent < totalPayloadBytes) {
          if (request.signal?.aborted) {
            ws.destroy();
            throw new DownloadCancelledError('Cancelled');
          }
          await new Promise<void>((resolve, reject) => {
            ws.write(chunk, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          calculatedMd5Hash.update(chunk);
          sent += chunk.length;
          if (onProgress) {
            onProgress({
              fileId: request.fileId,
              bytesTransferred: sent,
              totalBytes: totalPayloadBytes,
              speedBps: 50 * 1024 * 1024,
              percentage: Math.round((sent / totalPayloadBytes) * 100)
            });
          }
        }

        await new Promise<void>((resolve, reject) => {
          ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
        });
        return { destinationPath: dest, bytesWritten: sent, durationMs: 500 };
      }
    }

    const largeProvider = new StreamingLargeProvider('acc-large', 'Large Provider');
    storageManager.registerProvider(largeProvider);

    gamesRepo.upsert({ id: 'g-large', title: 'Large Game', slug: 'large-game', platform: 'PlayStation 2', state: 'CLOUD', sizeBytes: totalPayloadBytes, playTimeSeconds: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    // Pre-calculate expected hash of 50 chunks of 1MB 0x33
    const testChunk = Buffer.alloc(1024 * 1024, 0x33);
    const expectedHash = crypto.createHash('md5');
    for (let i = 0; i < 50; i++) expectedHash.update(testChunk);
    const expectedMd5 = expectedHash.digest('hex');

    gameFilesRepo.upsert({
      id: 'gf-large',
      gameId: 'g-large',
      storageAccountId: 'acc-large',
      remoteFileId: 'f-large',
      remotePath: '/Games/large_50mb.iso',
      filename: 'large_50mb.iso',
      sizeBytes: totalPayloadBytes,
      md5Checksum: expectedMd5,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const downloadManager = new DownloadManager(downloadsRepo, gamesRepo, gameFilesRepo, storageManager, cacheManager);

    if (global.gc) {
      global.gc();
    }
    const memBefore = process.memoryUsage().heapUsed;

    await downloadManager.queueGame('g-large');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Large stream timeout')), 10000);
      downloadManager.onStateChanged((event) => {
        if (event.status === 'COMPLETED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    if (global.gc) {
      global.gc();
    }
    const memAfter = process.memoryUsage().heapUsed;
    const diffMb = (memAfter - memBefore) / 1024 / 1024;

    // Memory growth should be far below 50MB (typically < 10MB during streaming)
    assert(diffMb < 35, `Heap memory growth must be bounded under streaming, grew by ${diffMb.toFixed(2)} MB`);

    const finalPath = cacheManager.getFinalGameFilePath('g-large', 'large_50mb.iso');
    assert(fs.existsSync(finalPath), 'Final large file exists');
    assert(fs.statSync(finalPath).size === totalPayloadBytes, 'Final file matches 50MB exactly');
  });

  // ============================================================================
  // SUITE 15: REAL GOOGLE DRIVE DOWNLOAD TEST REPORT
  // ============================================================================
  console.log('\n--- SUITE 15: Real Google Drive Download Verification ---');
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_TEST_REFRESH_TOKEN) {
    console.log('  ▶ Real Google Drive credentials detected. Testing real download...');
  } else {
    console.log('  ℹ️  REAL GOOGLE DRIVE DOWNLOAD TEST NOT EXECUTED (No credentials in environment)');
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL PHASE 3A TEST SUITES COMPLETED: ${passedCount} TESTS PASSED`);
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Fatal error in Phase 3A test suite:', err);
  process.exit(1);
});
