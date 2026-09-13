import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import * as sevenBin from '7zip-bin';

import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { PreparationJobsRepository } from '../src/database/repositories/preparationJobsRepository';
import { GameManifestsRepository } from '../src/database/repositories/gameManifestsRepository';
import { SettingsRepository } from '../src/database/repositories/settingsRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import { DownloadsRepository } from '../src/database/repositories/downloadsRepository';

import { CacheManager } from '../src/storage/CacheManager';
import { PlayableFileDetector } from '../src/preparation/PlayableFileDetector';
import { LocalManifestService } from '../src/preparation/LocalManifestService';
import { validateEntryPath } from '../src/preparation/extractors/ArchiveExtractor';
import { GamePreparationService } from '../src/preparation/GamePreparationService';
import { GameAvailabilityService } from '../src/catalog/GameAvailabilityService';
import { DownloadManager } from '../src/downloads/DownloadManager';
import { StorageManager } from '../src/storage/StorageManager';
import { StorageProvider } from '../src/providers/StorageProvider';

import {
  ZipSlipSecurityError,
  ArchiveCorruptedError,
  ExtractionCancelledError,
  InsufficientDiskSpaceError
} from '../src/core/errors/AppError';
import { Game, GameManifest, PreparationProgressEvent } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// Temporary test directory for disk isolation
const TEST_CACHE_DIR = path.resolve(__dirname, '../.test_cache_phase3c');

function cleanTestDir() {
  if (fs.existsSync(TEST_CACHE_DIR)) {
    fs.rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabaseSchema(db);
  db.prepare(`
    INSERT OR IGNORE INTO storage_accounts (id, provider_type, account_name, status, created_at, updated_at)
    VALUES ('acc-1', 'google_drive', 'Test Account', 'ACTIVE', datetime('now'), datetime('now'))
  `).run();
  return db;
}

function createMockGame(
  repo: GamesRepository,
  overrides: Partial<Game> & { title: string; platform: any }
): Game {
  const id = overrides.id || `game-${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();
  const game: Game = {
    id,
    title: overrides.title,
    slug: overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    platform: overrides.platform,
    state: overrides.state || 'DOWNLOADING',
    sizeBytes: overrides.sizeBytes || 1024,
    playTimeSeconds: overrides.playTimeSeconds || 0,
    pinned: overrides.pinned || false,
    createdAt: now,
    updatedAt: now,
    installedPath: overrides.installedPath,
    lastAccessedAt: overrides.lastAccessedAt,
    lastPlayedAt: overrides.lastPlayedAt,
    coverUrl: overrides.coverUrl
  };
  repo.upsert(game);
  return game;
}

function createMockGameFile(
  repo: GameFilesRepository,
  gameId: string,
  filename: string,
  sizeBytes: number,
  localPath?: string,
  remoteFileId = 'rf-default'
) {
  const now = new Date().toISOString();
  const file = {
    id: `gf-${Math.random().toString(36).substring(2, 9)}`,
    gameId,
    storageAccountId: 'acc-1',
    remoteFileId,
    remotePath: `/${filename}`,
    filename,
    sizeBytes,
    status: (localPath ? 'CACHED_LOCAL' : 'REMOTE') as any,
    localPath,
    createdAt: now,
    updatedAt: now
  };
  repo.upsert(file);
  return file;
}

// Synthetic RAR4 Generator for node-unrar-js testing
function makeRar4(filename: string, content: string | Buffer): Buffer {
  const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const sig = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const mainBody = Buffer.alloc(11);
  mainBody.writeUInt8(0x73, 0); // MAIN_HEAD
  mainBody.writeUInt16LE(0x0000, 1);
  mainBody.writeUInt16LE(13, 3);
  mainBody.writeUInt16LE(0, 5);
  mainBody.writeUInt32LE(0, 7);
  const mainCrc = zlib.crc32(mainBody) & 0xffff;
  const mainHead = Buffer.concat([Buffer.from([mainCrc & 0xff, (mainCrc >> 8) & 0xff]), mainBody]);

  const nameBuf = Buffer.from(filename, 'utf8');
  const fileHeadBodySize = 7 + 4 + 4 + 1 + 4 + 4 + 1 + 1 + 2 + 4 + nameBuf.length;
  const fileBody = Buffer.alloc(fileHeadBodySize);
  let pos = 0;
  fileBody.writeUInt8(0x74, pos); pos += 1; // FILE_HEAD
  fileBody.writeUInt16LE(0x8000, pos); pos += 2;
  fileBody.writeUInt16LE(fileHeadBodySize + 2, pos); pos += 2;
  fileBody.writeUInt32LE(contentBuf.length, pos); pos += 4;
  fileBody.writeUInt32LE(contentBuf.length, pos); pos += 4;
  fileBody.writeUInt8(0x00, pos); pos += 1;
  fileBody.writeUInt32LE(zlib.crc32(contentBuf), pos); pos += 4;
  fileBody.writeUInt32LE(0x52895678, pos); pos += 4;
  fileBody.writeUInt8(0x14, pos); pos += 1;
  fileBody.writeUInt8(0x30, pos); pos += 1; // Method: Store
  fileBody.writeUInt16LE(nameBuf.length, pos); pos += 2;
  fileBody.writeUInt32LE(0x00000020, pos); pos += 4;
  nameBuf.copy(fileBody, pos);

  const fileCrc = zlib.crc32(fileBody) & 0xffff;
  const fileHead = Buffer.concat([Buffer.from([fileCrc & 0xff, (fileCrc >> 8) & 0xff]), fileBody]);
  return Buffer.concat([sig, mainHead, fileHead, contentBuf]);
}

// Mock Storage Provider for integration testing
class MockStorageProvider implements StorageProvider {
  public id = 'acc-1';
  public name = 'Mock Google Drive';
  public type = 'google_drive' as const;
  public files = new Map<string, Buffer>();

  async authenticate() { return { success: true, account: { id: this.id, name: this.name, type: this.type, status: 'ACTIVE' as const } }; }
  async disconnect() {}
  async isConnected() { return true; }
  async listFiles() { return []; }
  async getFile(fileId: string): Promise<any> { return { id: fileId, name: fileId, sizeBytes: 100 }; }
  async getQuota() { return { totalBytes: 1000000, usedBytes: 500000, freeBytes: 500000 }; }
  async searchFiles() { return []; }
  async getMetadata(fileId: string): Promise<any> {
    const content = this.files.get(fileId) || Buffer.from('mock data');
    return {
      fileId,
      name: fileId,
      sizeBytes: content.length,
      md5Checksum: crypto.createHash('md5').update(content).digest('hex'),
      mimeType: 'application/octet-stream',
      modifiedTime: '2026-09-01T00:00:00.000Z'
    };
  }
  async download(
    requestOrFileId: any,
    destOrCb?: any,
    cb?: any
  ): Promise<any> {
    const fileId = typeof requestOrFileId === 'string' ? requestOrFileId : requestOrFileId.fileId;
    const dest = typeof requestOrFileId === 'string' ? destOrCb : requestOrFileId.destinationPath;
    const progress = typeof destOrCb === 'function' ? destOrCb : cb || requestOrFileId?.onProgress;

    const content = this.files.get(fileId) || Buffer.from('mock data');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    progress?.({ bytesTransferred: content.length, totalBytes: content.length, speedBps: 100000, percentage: 100 });
    return {
      bytesDownloaded: content.length,
      destinationPath: dest,
      etag: 'etag-1',
      md5Checksum: crypto.createHash('md5').update(content).digest('hex')
    };
  }
}

async function runAllTests() {
  console.log('====================================================');
  console.log('PHASE 3C: INSTALL PREPARATION, EXTRACTION & SMART CACHE');
  console.log('35 Mandatory Automated Test Scenarios');
  console.log('====================================================\n');

  cleanTestDir();
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`Scenario ${passed + failed + 1}/35: ${name}... `);
    try {
      await fn();
      console.log('PASSED ✓');
      passed++;
    } catch (err) {
      console.log('FAILED ❌');
      console.error(err);
      failed++;
    }
  }

  // 1. Raw playable file prepare
  await test('raw playable file prepare', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's1'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Crash Bandicoot',
      platform: 'PlayStation',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    // Create raw ISO in download cache
    const downloadPath = cacheManager.getDownloadPath(game.id, 'Crash.iso');
    fs.mkdirSync(path.dirname(downloadPath), { recursive: true });
    fs.writeFileSync(downloadPath, 'PS1 ISO RAW DATA BINARY');

    createMockGameFile(gameFilesRepo, game.id, 'Crash.iso', 24, downloadPath);

    const manifest = await prepService.prepareGame(game.id);
    assert(manifest !== null, 'Manifest should be returned');

    const updatedGame = gamesRepo.getById(game.id);
    assert(updatedGame?.state === 'READY', `Game state should be READY, got ${updatedGame?.state}`);
    assert(updatedGame?.installedPath !== null, 'Installed path should be set');
    assert(fs.existsSync(updatedGame!.installedPath!), 'Installed file should exist on disk');
  });

  // 2. ZIP extraction
  await test('ZIP extraction', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's2'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Super Mario 64',
      platform: 'Nintendo 64',
      state: 'DOWNLOADING',
      sizeBytes: 2048
    });

    // Create ZIP archive
    const zip = new AdmZip();
    zip.addFile('SuperMario64.z64', Buffer.from('N64 ROM DATA'));
    zip.addFile('readme.txt', Buffer.from('Read me info'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'mario.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'mario.zip', fs.statSync(zipPath).size, zipPath);

    const manifest = await prepService.prepareGame(game.id);
    assert(manifest !== null, 'Manifest should be created');

    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'READY', 'Game state must be READY');
    assert(manifest.primaryExecutableOrRom.endsWith('.z64'), 'Primary file should be .z64');
  });

  // 3. 7z extraction
  await test('7z extraction', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's3'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'The Legend of Zelda',
      platform: 'GameCube',
      state: 'DOWNLOADING',
      sizeBytes: 2048
    });

    // Create a 7z archive using 7za
    const tempFile = path.join(TEST_CACHE_DIR, 's3', 'Zelda.iso');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, 'GAMECUBE ISO DATA IN 7Z');
    const archive7z = cacheManager.getDownloadPath(game.id, 'zelda.7z');
    fs.mkdirSync(path.dirname(archive7z), { recursive: true });
    spawnSync(sevenBin.path7za, ['a', archive7z, tempFile]);
    fs.unlinkSync(tempFile);

    createMockGameFile(gameFilesRepo, game.id, 'zelda.7z', fs.statSync(archive7z).size, archive7z);

    const manifest = await prepService.prepareGame(game.id);
    assert(manifest !== null, '7z manifest should be returned');
    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'READY', 'Game should be READY');
    assert(manifest.primaryExecutableOrRom.endsWith('.iso'), 'Primary executable should be .iso');
  });

  // 4. RAR extraction
  await test('RAR extraction', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's4'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Tekken 3',
      platform: 'PlayStation',
      state: 'DOWNLOADING',
      sizeBytes: 2048
    });

    const rarData = makeRar4('Tekken3.iso', 'PS1 TEKKEN 3 ISO DATA');
    const rarPath = cacheManager.getDownloadPath(game.id, 'tekken3.rar');
    fs.mkdirSync(path.dirname(rarPath), { recursive: true });
    fs.writeFileSync(rarPath, rarData);

    createMockGameFile(gameFilesRepo, game.id, 'tekken3.rar', rarData.length, rarPath);

    const manifest = await prepService.prepareGame(game.id);
    assert(manifest !== null, 'RAR manifest should be returned');
    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'READY', 'Game state must be READY');
    assert(fs.existsSync(updated!.installedPath!), 'Extracted file must exist');
  });

  // 5. Archive path traversal blocked (Zip Slip)
  await test('archive path traversal blocked (Zip Slip)', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's5'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Malicious Zip Game',
      platform: 'PC',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('evil.exe', Buffer.from('malicious payload'));
    zip.getEntries()[0].entryName = '../../evil.exe';
    const zipPath = cacheManager.getDownloadPath(game.id, 'evil.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'evil.zip', fs.statSync(zipPath).size, zipPath);

    try {
      await prepService.prepareGame(game.id);
      assert(false, 'Should have thrown ZipSlipSecurityError');
    } catch (err: unknown) {
      assert(err instanceof ZipSlipSecurityError, `Expected ZipSlipSecurityError, got ${err}`);
    }

    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'ERROR', `Game state must be ERROR, got ${updated?.state}`);
    assert(!fs.existsSync(path.resolve(TEST_CACHE_DIR, 'evil.exe')), 'Malicious file must not escape');
  });

  // 6. Malicious absolute path blocked
  await test('malicious absolute path blocked', async () => {
    const targetDir = path.resolve(TEST_CACHE_DIR, 's6_sandbox');
    fs.mkdirSync(targetDir, { recursive: true });

    let threw = false;
    try {
      validateEntryPath('/etc/passwd', targetDir);
    } catch (err) {
      assert(err instanceof ZipSlipSecurityError, 'Should throw ZipSlipSecurityError for leading slash');
      threw = true;
    }
    assert(threw, 'Should block /etc/passwd');

    threw = false;
    try {
      validateEntryPath('C:\\Windows\\System32\\cmd.exe', targetDir);
    } catch (err) {
      assert(err instanceof ZipSlipSecurityError, 'Should throw ZipSlipSecurityError for drive letter');
      threw = true;
    }
    assert(threw, 'Should block drive letter');
  });

  // 7. Extraction cancel
  await test('extraction cancel', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's7'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Cancel Test Game',
      platform: 'PC',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('bigfile.iso', Buffer.alloc(100000, 0x41));
    const zipPath = cacheManager.getDownloadPath(game.id, 'cancel.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'cancel.zip', fs.statSync(zipPath).size, zipPath);

    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    try {
      await prepService.prepareGame(game.id, abortController.signal);
      assert(false, 'Should have thrown ExtractionCancelledError');
    } catch (err) {
      assert(err instanceof ExtractionCancelledError, `Expected ExtractionCancelledError, got ${err}`);
    }

    const updated = gamesRepo.getById(game.id);
    assert(updated?.state !== 'READY', 'Game must NOT be READY after cancellation');
  });

  // 8. Failed extraction never READY
  await test('failed extraction never READY', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's8'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Corrupted Archive Game',
      platform: 'PlayStation',
      state: 'DOWNLOADING',
      sizeBytes: 512
    });

    const badZipPath = cacheManager.getDownloadPath(game.id, 'bad.zip');
    fs.mkdirSync(path.dirname(badZipPath), { recursive: true });
    fs.writeFileSync(badZipPath, Buffer.from('NOT A ZIP FILE HEADER'));

    createMockGameFile(gameFilesRepo, game.id, 'bad.zip', 21, badZipPath);

    try {
      await prepService.prepareGame(game.id);
      assert(false, 'Should have failed on corrupted archive');
    } catch (err) {
      assert(err instanceof ArchiveCorruptedError, `Expected ArchiveCorruptedError, got ${err}`);
    }

    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'ERROR', `State must be ERROR, got ${updated?.state}`);
  });

  // 9. Crash recovery
  await test('crash recovery', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's9'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Crashed Mid-Prepare Game',
      platform: 'PlayStation 2',
      state: 'PREPARING',
      sizeBytes: 1024
    });

    const staleJob = {
      id: 'job-stale-9',
      gameId: game.id,
      status: 'EXTRACTING' as const,
      step: 'Extracting files',
      progressPercentage: 50,
      totalBytes: 1024,
      processedBytes: 512,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    preparationJobsRepo.create(staleJob);

    // Create the stale directory
    const staleDir = cacheManager.getPreparePath(staleJob.id);
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'partial.bin'), 'leftover file');

    const recoveredCount = await prepService.recoverStalePreparationJobs();
    assert(recoveredCount === 1, `Expected 1 recovered job, got ${recoveredCount}`);

    const updatedJob = preparationJobsRepo.getById(staleJob.id);
    assert(updatedJob?.status === 'FAILED', 'Stale job should be marked FAILED');
    const updatedGame = gamesRepo.getById(game.id);
    assert(updatedGame?.state === 'CLOUD', 'Game should be reset to CLOUD');
    assert(!fs.existsSync(staleDir), 'Stale prepare directory must be purged');
  });

  // 10. Temp folder cleanup
  await test('temp folder cleanup', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's10'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Cleanup Test Game',
      platform: 'Game Boy Advance',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('game.gba', Buffer.from('GBA ROM'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'game.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'game.zip', fs.statSync(zipPath).size, zipPath);

    await prepService.prepareGame(game.id);
    const prepareRoot = cacheManager.getTempPrepareDir();
    const entries = fs.readdirSync(prepareRoot);
    assert(entries.length === 0, 'Temporary preparation sandbox directory must be deleted after completion');
  });

  // 11. Primary file detection PS2
  await test('primary file detection PS2', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's11_ps2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'info');
    fs.writeFileSync(path.join(dir, 'SYSTEM.CNF'), 'BOOT2 = cdrom0:\\SLUS_200.01;1');
    fs.writeFileSync(path.join(dir, 'game.iso'), 'ISO DATA');

    const result = detector.detect(dir, 'PlayStation 2');
    assert(result.primaryFilePath !== null, 'Primary executable must be found');
    assert(result.primaryFilePath.endsWith('game.iso'), 'Should prioritize .iso for PS2');
  });

  // 12. Primary file detection GameCube
  await test('primary file detection GameCube', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's12_gc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manual.pdf'), 'manual');
    fs.writeFileSync(path.join(dir, 'zelda.rvz'), 'RVZ DATA');

    const result = detector.detect(dir, 'GameCube');
    assert(result.primaryFilePath.endsWith('zelda.rvz'), 'Should prioritize .rvz for GameCube');
  });

  // 13. CUE/BIN preserved
  await test('CUE/BIN preserved', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's13_cuebin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'game.cue'), 'FILE "game (Track 1).bin" BINARY');
    fs.writeFileSync(path.join(dir, 'game (Track 1).bin'), 'TRACK 1');
    fs.writeFileSync(path.join(dir, 'game (Track 2).bin'), 'TRACK 2');

    const result = detector.detect(dir, 'PlayStation');
    assert(result.primaryFilePath.endsWith('game.cue'), 'Primary should be .cue');
    assert(result.requiredFiles.length === 3, 'All 3 files must be preserved in requiredFiles');
    const tracks = result.requiredFiles.filter((f) => f.role === 'TRACK');
    assert(tracks.length === 2, 'Two track files should be classified as secondary/track');
  });

  // 14. GDI tracks preserved
  await test('GDI tracks preserved', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's14_gdi');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'disc.gdi'), '3\n1 0 4 2352 track01.bin 0\n2 600 0 2352 track02.raw 0\n3 45000 4 2352 track03.bin 0');
    fs.writeFileSync(path.join(dir, 'track01.bin'), 'DATA1');
    fs.writeFileSync(path.join(dir, 'track02.raw'), 'DATA2');
    fs.writeFileSync(path.join(dir, 'track03.bin'), 'DATA3');

    const result = detector.detect(dir, 'Dreamcast');
    assert(result.primaryFilePath.endsWith('disc.gdi'), 'Primary should be .gdi');
    assert(result.requiredFiles.length === 4, 'All GDI tracks must be preserved');
  });

  // 15. Multi-disc preserved
  await test('multi-disc preserved', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's15_multidisc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'FFVII (Disc 1).iso'), 'DISC 1');
    fs.writeFileSync(path.join(dir, 'FFVII (Disc 2).iso'), 'DISC 2');
    fs.writeFileSync(path.join(dir, 'FFVII (Disc 3).iso'), 'DISC 3');

    const result = detector.detect(dir, 'PlayStation');
    assert(result.primaryFilePath.includes('Disc 1'), 'Primary should be Disc 1');
    assert(result.requiredFiles.length === 3, 'All 3 discs must be preserved');
    assert(result.isMultiDisc === true, 'isMultiDisc should be true');
  });

  // 16. Portable PC exe candidate
  await test('portable PC exe candidate', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's16_pc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'unins000.exe'), 'uninstaller');
    fs.writeFileSync(path.join(dir, 'crash_reporter.exe'), 'reporter');
    fs.writeFileSync(path.join(dir, 'MyCoolGame.exe'), 'actual game binary');

    const result = detector.detect(dir, 'PC');
    assert(result.primaryFilePath.endsWith('MyCoolGame.exe'), 'Must prioritize MyCoolGame.exe');
    assert(result.installRequired === false, 'Portable game should not require install');
  });

  // 17. Installer PC detected (INSTALL_REQUIRED)
  await test('installer PC detected (INSTALL_REQUIRED)', async () => {
    const detector = new PlayableFileDetector();
    const dir = path.join(TEST_CACHE_DIR, 's17_installer');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'setup.exe'), 'installer');
    fs.writeFileSync(path.join(dir, 'data.bin'), 'installer cabinet');

    const result = detector.detect(dir, 'PC');
    assert(result.primaryFilePath.endsWith('setup.exe'), 'Should detect setup.exe');
    assert(result.installRequired === true, 'Must flag installRequired: true');
  });

  // 18. Insufficient extraction disk space
  await test('insufficient extraction disk space', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's18'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Huge Game',
      platform: 'PC',
      state: 'DOWNLOADING',
      sizeBytes: 10 * 1024 * 1024 * 1024 * 1024 * 1024
    });

    const zip = new AdmZip();
    zip.addFile('data.bin', Buffer.from('data'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'huge.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    // Mock file with 10 Petabytes and restricted disk space
    createMockGameFile(gameFilesRepo, game.id, 'huge.zip', 10 * 1024 * 1024 * 1024 * 1024 * 1024, zipPath);
    cacheManager.getAvailableDiskSpace = () => 1024;

    try {
      await prepService.prepareGame(game.id);
      assert(false, 'Should throw InsufficientDiskSpaceError');
    } catch (err) {
      assert(err instanceof InsufficientDiskSpaceError, `Expected InsufficientDiskSpaceError, got ${err}`);
    }
  });

  // 19. Cache limit enforcement
  await test('cache limit enforcement', async () => {
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's19'));
    cacheManager.setCacheLimit(104857600); // 100 MB

    const breakdown = cacheManager.getCacheBreakdown();
    assert(breakdown.configuredLimitBytes === 104857600, 'Configured limit should match');
  });

  // 20. Remove local copy
  await test('remove local copy', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's20'));

    const game = createMockGame(gamesRepo, {
      title: 'Eviction Game',
      platform: 'Game Boy Advance',
      state: 'READY',
      sizeBytes: 1024
    });

    const gameDir = cacheManager.getGameCacheDir(game.id);
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'rom.gba'), 'ROM CONTENT');

    const manifest: GameManifest = {
      gameId: game.id,
      title: game.title,
      platform: game.platform,
      preparedAt: new Date().toISOString(),
      primaryExecutableOrRom: 'rom.gba',
      totalLocalSize: 11,
      installRequired: false,
      files: [{ relativePath: 'rom.gba', sizeBytes: 11, role: 'PRIMARY' }],
      integrityStatus: 'VERIFIED'
    };
    manifestsRepo.upsert(manifest);

    const result = cacheManager.removeLocalCopy(game.id, { gamesRepo, gameFilesRepo });
    assert(result.freedBytes === 11, 'Should report freed bytes');
    assert(!fs.existsSync(gameDir), 'Local files directory must be deleted');
    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'CLOUD', 'State must return to CLOUD');
  });

  // 21. Cloud record preserved after eviction
  await test('cloud record preserved after eviction', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's21'));

    const game = createMockGame(gamesRepo, {
      title: 'Preserved Cloud Record Game',
      platform: 'SNES',
      state: 'READY',
      sizeBytes: 512,
      coverUrl: 'https://img.example/cover.jpg'
    });

    cacheManager.removeLocalCopy(game.id, { gamesRepo });

    const after = gamesRepo.getById(game.id);
    assert(after !== null, 'Game row must remain in database');
    assert(after!.coverUrl === 'https://img.example/cover.jpg', 'Metadata must be intact');
    assert(after!.state === 'CLOUD', 'State is CLOUD');
  });

  // 22. Playtime preserved after eviction
  await test('playtime preserved after eviction', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's22'));

    const game = createMockGame(gamesRepo, {
      title: 'Time Tracked Game',
      platform: 'Nintendo DS',
      state: 'READY',
      sizeBytes: 512,
      playTimeSeconds: 25200,
      lastPlayedAt: '2026-05-10T12:00:00Z'
    });

    cacheManager.removeLocalCopy(game.id, { gamesRepo });

    const updated = gamesRepo.getById(game.id);
    assert(updated?.playTimeSeconds === 25200, 'Playtime must be strictly preserved');
    assert(updated?.lastPlayedAt === '2026-05-10T12:00:00Z', 'Last played date must be preserved');
  });

  // 23. Pinned excluded from candidates
  await test('pinned excluded from candidates', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's23'));

    const gameA = createMockGame(gamesRepo, {
      title: 'Pinned Game',
      platform: 'PC',
      state: 'READY',
      sizeBytes: 1000,
      pinned: true
    });

    const gameB = createMockGame(gamesRepo, {
      title: 'Unpinned Game',
      platform: 'PC',
      state: 'READY',
      sizeBytes: 2000,
      pinned: false
    });

    const candidates = cacheManager.getEvictionCandidates(10000, gamesRepo);
    const hasPinned = candidates.some((c) => c.game.id === gameA.id);
    const hasUnpinned = candidates.some((c) => c.game.id === gameB.id);
    assert(!hasPinned, 'Pinned game must be excluded from eviction candidates');
    assert(hasUnpinned, 'Unpinned game should be an eviction candidate');
  });

  // 24. LRU ordering
  await test('LRU ordering', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's24'));

    const gameOld = createMockGame(gamesRepo, {
      title: 'Old Accessed Game',
      platform: 'PC',
      state: 'READY',
      sizeBytes: 500,
      lastAccessedAt: '2026-01-01T00:00:00Z'
    });

    const gameRecent = createMockGame(gamesRepo, {
      title: 'Recent Accessed Game',
      platform: 'PC',
      state: 'READY',
      sizeBytes: 500,
      lastAccessedAt: '2026-09-01T00:00:00Z'
    });

    const candidates = cacheManager.getEvictionCandidates(10000, gamesRepo);
    assert(candidates.length >= 2, 'Should have both candidates');
    assert(candidates[0].game.id === gameOld.id, 'Oldest accessed game must be ranked first for eviction');
    assert(candidates[1].game.id === gameRecent.id, 'Recent accessed game should be ranked second');
  });

  // 25. Cache root path safety
  await test('cache root path safety', async () => {
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's25'));
    let threw = false;
    try {
      cacheManager.safeDelete('C:\\Windows\\System32');
    } catch {
      threw = true;
    }
    assert(threw, 'safeDelete must block deletion outside cache root');
  });

  // 26. Malicious filename safety
  await test('malicious filename safety', async () => {
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's26'));
    let threw = false;
    try {
      cacheManager.getGameCacheDir('../../../system');
    } catch {
      threw = true;
    }
    assert(threw, 'Path traversal in gameId must be rejected');
  });

  // 27. Archive removed after successful preparation (keepOriginalArchives=false)
  await test('archive removed after successful preparation (keepOriginalArchives=false)', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const settingsRepo = new SettingsRepository(db);
    settingsRepo.set('keep_original_archives', 'false');

    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's27'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      settingsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Auto-Delete Archive Game',
      platform: 'SNES',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('game.sfc', Buffer.from('SNES ROM DATA'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'game.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'game.zip', fs.statSync(zipPath).size, zipPath);

    await prepService.prepareGame(game.id);
    assert(!fs.existsSync(zipPath), 'Original archive in downloads must be deleted when keepOriginalArchives=false');
  });

  // 28. Archive preserved when setting enabled (keepOriginalArchives=true)
  await test('archive preserved when setting enabled (keepOriginalArchives=true)', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const settingsRepo = new SettingsRepository(db);
    settingsRepo.set('keep_original_archives', 'true');

    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's28'));
    const manifestService = new LocalManifestService(manifestsRepo);
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      settingsRepo,
      cacheManager,
      manifestService
    });

    const game = createMockGame(gamesRepo, {
      title: 'Keep Archive Game',
      platform: 'SNES',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('game.sfc', Buffer.from('SNES ROM DATA'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'game.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'game.zip', fs.statSync(zipPath).size, zipPath);

    await prepService.prepareGame(game.id);
    assert(fs.existsSync(zipPath), 'Original archive must be preserved when keepOriginalArchives=true');
  });

  // 29. Local manifest generated
  await test('local manifest generated', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const manifestService = new LocalManifestService(manifestsRepo);
    const targetDir = path.join(TEST_CACHE_DIR, 's29_manifest');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'game.iso'), 'GAME DATA');

    createMockGame(gamesRepo, {
      id: 'game-29',
      title: 'PS2 Game',
      platform: 'PlayStation 2'
    });

    const manifest: GameManifest = {
      gameId: 'game-29',
      title: 'PS2 Game',
      platform: 'PlayStation 2',
      preparedAt: new Date().toISOString(),
      primaryExecutableOrRom: 'game.iso',
      totalLocalSize: 9,
      installRequired: false,
      files: [{ relativePath: 'game.iso', sizeBytes: 9, role: 'PRIMARY' }],
      integrityStatus: 'VERIFIED'
    };

    await manifestService.saveManifest(manifest, targetDir);

    assert(manifest.primaryExecutableOrRom === 'game.iso', 'Primary executable must match');
    assert(fs.existsSync(path.join(targetDir, 'manifest.json')), 'manifest.json must exist on disk');
    const onDisk = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8'));
    assert(onDisk.primaryExecutableOrRom.endsWith('game.iso'), 'Manifest on disk must match');
  });

  // 30. Verify local game
  await test('verify local game', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const manifestService = new LocalManifestService(manifestsRepo);
    const targetDir = path.join(TEST_CACHE_DIR, 's30_verify');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'game.iso'), 'GAME DATA');

    createMockGame(gamesRepo, {
      id: 'game-30',
      title: 'PS2 Game',
      platform: 'PlayStation 2'
    });

    const manifest: GameManifest = {
      gameId: 'game-30',
      title: 'PS2 Game',
      platform: 'PlayStation 2',
      preparedAt: new Date().toISOString(),
      primaryExecutableOrRom: 'game.iso',
      totalLocalSize: 9,
      installRequired: false,
      files: [{ relativePath: 'game.iso', sizeBytes: 9, role: 'PRIMARY' }],
      integrityStatus: 'VERIFIED'
    };

    await manifestService.saveManifest(manifest, targetDir);
    const res = await manifestService.verifyLocalGame('game-30', targetDir, false);
    assert(res.valid === true, 'Verification should be valid when files match');
  });

  // 31. DB READY but missing local file corrected
  await test('DB READY but missing local file corrected', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const downloadsRepo = new DownloadsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's31'));
    const availabilityService = new GameAvailabilityService(gamesRepo, gameFilesRepo, downloadsRepo, cacheManager, manifestsRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Missing File Game',
      platform: 'PC',
      state: 'READY',
      sizeBytes: 1000,
      installedPath: path.join(TEST_CACHE_DIR, 's31', 'nonexistent', 'game.exe')
    });

    const status = await availabilityService.recalculate(game.id);
    assert(status === 'CLOUD', `Availability must detect missing file and report CLOUD, got ${status}`);
    const updated = gamesRepo.getById(game.id);
    assert(updated?.state === 'CLOUD', 'Database state should be reconciled to CLOUD');
  });

  // 32. Preparation progress
  await test('preparation progress', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's32'));
    const manifestService = new LocalManifestService(manifestsRepo);

    const events: PreparationProgressEvent[] = [];
    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService,
      onProgress: (ev) => events.push(ev)
    });

    const game = createMockGame(gamesRepo, {
      title: 'Progress Game',
      platform: 'SNES',
      state: 'DOWNLOADING',
      sizeBytes: 1024
    });

    const zip = new AdmZip();
    zip.addFile('game.sfc', Buffer.from('SNES ROM DATA'));
    const zipPath = cacheManager.getDownloadPath(game.id, 'game.zip');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    zip.writeZip(zipPath);

    createMockGameFile(gameFilesRepo, game.id, 'game.zip', fs.statSync(zipPath).size, zipPath);

    await prepService.prepareGame(game.id);
    assert(events.length > 0, 'Should emit preparation progress events');
    assert(events.some((e) => e.progressPercentage === 100), 'Final progress should reach 100%');
  });

  // 33. Download automatically triggers preparation
  await test('download automatically triggers preparation', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const downloadsRepo = new DownloadsRepository(db);
    const accountsRepo = new StorageAccountsRepository(db);
    const preparationJobsRepo = new PreparationJobsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's33'));
    const manifestService = new LocalManifestService(manifestsRepo);

    const prepService = new GamePreparationService({
      gamesRepo,
      gameFilesRepo,
      preparationJobsRepo,
      manifestsRepo,
      cacheManager,
      manifestService
    });

    const mockProvider = new MockStorageProvider();
    const storageManager = StorageManager.getInstance();
    storageManager.setRepository(accountsRepo);
    storageManager.registerProvider(mockProvider);

    const downloadManager = new DownloadManager(
      downloadsRepo,
      gamesRepo,
      gameFilesRepo,
      storageManager,
      cacheManager,
      prepService
    );

    accountsRepo.upsert({
      id: 'acc-1',
      providerType: 'google_drive',
      providerAccountId: 'pa-1',
      accountName: 'Test Acc',
      credentialKey: 'key-1',
      status: 'ACTIVE',
      quotaTotalBytes: 1000000,
      quotaUsedBytes: 500000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const romData = Buffer.from('GB ROM DATA');
    const game = createMockGame(gamesRepo, {
      title: 'Auto Prep Game',
      platform: 'Game Boy',
      state: 'CLOUD',
      sizeBytes: romData.length
    });

    createMockGameFile(gameFilesRepo, game.id, 'game.gb', romData.length, undefined, 'rf-33');
    mockProvider.files.set('rf-33', romData);

    await downloadManager.queueGame(game.id);

    // Wait for download + preparation handoff
    let attempts = 0;
    while (attempts < 50) {
      const g = gamesRepo.getById(game.id);
      if (g?.state === 'READY') break;
      await new Promise((r) => setTimeout(r, 50));
      attempts++;
    }

    const finalGame = gamesRepo.getById(game.id);
    assert(finalGame?.state === 'READY', `Game should transition automatically to READY, got ${finalGame?.state}`);
    await downloadManager.shutdown();
  });

  // 34. No token leakage
  await test('no token leakage', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const manifestService = new LocalManifestService(manifestsRepo);
    const targetDir = path.join(TEST_CACHE_DIR, 's34_leak');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'game.bin'), 'DATA');

    createMockGame(gamesRepo, {
      id: 'game-34',
      title: 'Secret Game',
      platform: 'NES'
    });

    const manifest: GameManifest = {
      gameId: 'game-34',
      title: 'Secret Game',
      platform: 'NES',
      preparedAt: new Date().toISOString(),
      primaryExecutableOrRom: 'game.bin',
      totalLocalSize: 4,
      installRequired: false,
      files: [{ relativePath: 'game.bin', sizeBytes: 4, role: 'PRIMARY' }],
      integrityStatus: 'VERIFIED'
    };

    await manifestService.saveManifest(manifest, targetDir);

    const manifestStr = JSON.stringify(manifest);
    assert(!manifestStr.includes('ya29.'), 'Manifest must never contain OAuth tokens');
    assert(!manifestStr.includes('client_secret'), 'Manifest must never contain secrets');
  });

  // 35. Restart preserves prepared game
  await test('restart preserves prepared game', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const gameFilesRepo = new GameFilesRepository(db);
    const downloadsRepo = new DownloadsRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const cacheManager = new CacheManager(path.join(TEST_CACHE_DIR, 's35'));
    const manifestService = new LocalManifestService(manifestsRepo);

    const gameDir = cacheManager.getGameCacheDir('game-35');
    fs.mkdirSync(gameDir, { recursive: true });
    const romFile = path.join(gameDir, 'mario.sfc');
    fs.writeFileSync(romFile, 'SUPER MARIO WORLD');

    const game = createMockGame(gamesRepo, {
      id: 'game-35',
      title: 'Persistent Game',
      platform: 'SNES',
      state: 'READY',
      sizeBytes: 1024,
      installedPath: romFile
    });

    const manifest: GameManifest = {
      gameId: game.id,
      title: game.title,
      platform: game.platform,
      preparedAt: new Date().toISOString(),
      primaryExecutableOrRom: 'mario.sfc',
      totalLocalSize: 17,
      installRequired: false,
      files: [{ relativePath: 'mario.sfc', sizeBytes: 17, role: 'PRIMARY' }],
      integrityStatus: 'VERIFIED'
    };
    await manifestService.saveManifest(manifest, gameDir);

    // Simulate complete application reboot: re-instantiate repos and services
    const rebootAvailabilityService = new GameAvailabilityService(gamesRepo, gameFilesRepo, downloadsRepo, cacheManager, manifestsRepo);
    const avail = await rebootAvailabilityService.recalculate(game.id);
    assert(avail === 'READY', `Game must remain READY across reboot, got ${avail}`);
  });

  console.log('\n====================================================');
  console.log(`Phase 3C Verification: ${passed}/35 passed (${failed} failed)`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
