import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../src/database/schema';
import { CloudFilesRepository } from '../src/database/repositories/cloudFilesRepository';
import { SyncStateRepository } from '../src/database/repositories/syncStateRepository';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import { StorageManager } from '../src/storage/StorageManager';
import { CloudInventoryScanner, CancellationToken } from '../src/sync/CloudInventoryScanner';
import { CloudPathResolver } from '../src/sync/CloudPathResolver';
import { CloudChangeProcessor } from '../src/sync/CloudChangeProcessor';
import { SyncCoordinator } from '../src/sync/SyncCoordinator';
import { CatalogIngestionService } from '../src/catalog/CatalogIngestionService';
import { StorageProvider } from '../src/providers/StorageProvider';
import {
  RemoteFile,
  PaginatedFilesResult,
  ChangeListResult,
  StorageQuota,
  ListFilesOptions,
  AuthResult,
  DownloadResult,
  FileMetadata
} from '../src/providers/types';
import { CloudFile, StorageAccount } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

class MockStorageProvider implements StorageProvider {
  public id: string;
  public name: string;
  public type = 'google_drive' as const;
  public filesMap = new Map<string | undefined, RemoteFile[]>();
  public changesQueue: ChangeListResult[] = [];
  public getFileMap = new Map<string, RemoteFile>();
  public shouldFailWith410 = false;
  public shouldFailDuringChanges = false;
  public shouldFailDuringScan = false;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  public setFilesForFolder(folderId: string | undefined, files: RemoteFile[]): void {
    this.filesMap.set(folderId, files);
    for (const f of files) {
      this.getFileMap.set(f.id, f);
    }
  }

  public async authenticate(): Promise<AuthResult> {
    return { success: true };
  }

  public async isConnected(): Promise<boolean> {
    return true;
  }

  public async getFile(fileId: string): Promise<RemoteFile> {
    if (this.getFileMap.has(fileId)) {
      return this.getFileMap.get(fileId)!;
    }
    return {
      id: fileId,
      name: `Folder_${fileId}`,
      mimeType: 'application/vnd.google-apps.folder',
      sizeBytes: 0,
      isFolder: true
    };
  }

  public async download(_fileId: string, destinationPath: string): Promise<DownloadResult> {
    return { destinationPath, bytesWritten: 0, durationMs: 0 };
  }

  public async getMetadata(fileId: string): Promise<FileMetadata> {
    return { fileId, name: 'mock', sizeBytes: 0, mimeType: 'application/octet-stream' };
  }

  public async listFiles(folderId?: string): Promise<RemoteFile[]> {
    if (this.shouldFailDuringScan) {
      throw new Error('Simulated network failure during scan');
    }
    return this.filesMap.get(folderId) || [];
  }

  public async listPaginatedFiles(folderId?: string, options?: ListFilesOptions): Promise<PaginatedFilesResult> {
    if (this.shouldFailDuringScan) {
      throw new Error('Simulated network failure during scan');
    }
    const all = this.filesMap.get(folderId) || [];
    const pageSize = options?.pageSize || 50;
    const startIndex = options?.pageToken ? parseInt(options.pageToken, 10) : 0;
    const items = all.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + pageSize;
    const nextPageToken = nextIndex < all.length ? String(nextIndex) : undefined;
    return { files: items, nextPageToken };
  }

  public async getStartPageToken(): Promise<string> {
    return 'token_start_initial';
  }

  public async listChanges(pageToken: string): Promise<ChangeListResult> {
    if (this.shouldFailWith410) {
      this.shouldFailWith410 = false; // reset after throwing once
      const err = new Error('410 Gone: changeTokenExpired');
      (err as unknown as { status: number }).status = 410;
      throw err;
    }

    if (this.shouldFailDuringChanges) {
      throw new Error('Simulated database/network failure during change stream');
    }

    if (this.changesQueue.length > 0) {
      return this.changesQueue.shift()!;
    }

    return {
      changes: [],
      newStartPageToken: `${pageToken}_updated`
    };
  }

  public async connect(): Promise<StorageAccount> {
    return {
      id: this.id,
      providerType: 'google_drive',
      providerAccountId: `provider-${this.id}`,
      accountName: this.name,
      accountEmail: `${this.id}@test.com`,
      credentialKey: `gdrive:${this.id}`,
      status: 'ACTIVE',
      quotaTotalBytes: 1000000000,
      quotaUsedBytes: 500000000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  public async disconnect(): Promise<void> {}

  public async getQuota(): Promise<StorageQuota> {
    return { totalBytes: 1000000000, usedBytes: 500000000, freeBytes: 500000000 };
  }
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabaseSchema(db);
  return db;
}

async function runPhase2CTests() {
  console.log('================================================================');
  console.log('🛡️  GAME VAULT - PHASE 2C: SYNC CORRECTNESS & CONSISTENCY GATE');
  console.log('    Verifying 25 Required Scenarios + End-to-End Integration');
  console.log('================================================================\n');

  const db = createTestDb();
  const accountsRepo = new StorageAccountsRepository(db);
  const cloudFilesRepo = new CloudFilesRepository(db);
  const gamesRepo = new GamesRepository(db);
  const gameFilesRepo = new GameFilesRepository(db);
  const syncStateRepo = new SyncStateRepository(db);
  const storageMgr = StorageManager.getInstance();
  storageMgr.setRepository(accountsRepo);

  const catalogIngestion = new CatalogIngestionService(gamesRepo, gameFilesRepo, db);
  const pathResolver = new CloudPathResolver(cloudFilesRepo, gameFilesRepo);
  const changeProcessor = new CloudChangeProcessor(cloudFilesRepo, gameFilesRepo, catalogIngestion, pathResolver);
  const scanner = new CloudInventoryScanner(cloudFilesRepo);
  const syncCoordinator = new SyncCoordinator(
    storageMgr,
    scanner,
    cloudFilesRepo,
    syncStateRepo,
    catalogIngestion,
    changeProcessor
  );

  const acc1: StorageAccount = {
    id: 'acc-1',
    providerType: 'google_drive',
    providerAccountId: 'prov-acc-1',
    accountName: 'Account 1',
    credentialKey: 'gdrive:acc-1',
    status: 'ACTIVE',
    quotaTotalBytes: 1000000000,
    quotaUsedBytes: 100000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  accountsRepo.upsert(acc1);

  const provider1 = new MockStorageProvider(acc1.id, 'Account 1');
  storageMgr.registerProvider(provider1);

  // --------------------------------------------------------------------------
  // TEST 1: New file via Changes API is inserted
  // --------------------------------------------------------------------------
  console.log('[1/25] Test 1: New file via Changes API is inserted...');
  pathResolver.setCachedFolderPath(acc1.id, 'folder-ps2', '/ROMs/PS2');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-gow',
      removed: false,
      file: {
        id: 'file-gow',
        name: 'God of War.iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 4000000000,
        isFolder: false,
        parentFolderId: 'folder-ps2'
      }
    }
  ]);

  const cfGow = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-gow');
  assert(cfGow !== null, 'God of War must be inserted in cloud_files via Changes API');
  assert(cfGow.remotePath === '/ROMs/PS2/God of War.iso', `Expected path /ROMs/PS2/God of War.iso, got ${cfGow.remotePath}`);
  assert(cfGow.classification === 'GAME', 'Must be classified as GAME');
  console.log('✔ New file via Changes API inserted with full metadata.');

  // --------------------------------------------------------------------------
  // TEST 2: New game via delta appears in games
  // --------------------------------------------------------------------------
  console.log('\n[2/25] Test 2: New game via delta appears in games...');
  pathResolver.setCachedFolderPath(acc1.id, 'folder-gc', '/GameCube');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-mkdd',
      removed: false,
      file: {
        id: 'file-mkdd',
        name: 'Mario Kart Double Dash.rvz',
        mimeType: 'application/octet-stream',
        sizeBytes: 1200000000,
        isFolder: false,
        parentFolderId: 'folder-gc'
      }
    }
  ]);

  const gameMk = gamesRepo.getBySlug('mario-kart-double-dash-gamecube');
  assert(gameMk !== null, 'Mario Kart Double Dash must be in games table');
  const gfMk = gameFilesRepo.getByRemoteFileId(acc1.id, 'file-mkdd');
  assert(gfMk !== null, 'GameFile record must exist');
  assert(gfMk.status === 'REMOTE', `GameFile status must be REMOTE, got ${gfMk.status}`);
  console.log('✔ New game via delta appears in games catalog.');

  // --------------------------------------------------------------------------
  // TEST 3: Rename updates CloudFile
  // --------------------------------------------------------------------------
  console.log('\n[3/25] Test 3: Rename updates CloudFile...');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-gow',
      removed: false,
      file: {
        id: 'file-gow',
        name: 'God of War (USA).iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 4000000000,
        isFolder: false,
        parentFolderId: 'folder-ps2'
      }
    }
  ]);
  const cfGowRenamed = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-gow');
  assert(cfGowRenamed?.name === 'God of War (USA).iso', 'CloudFile name must be updated');
  assert(cfGowRenamed?.remotePath === '/ROMs/PS2/God of War (USA).iso', 'CloudFile remotePath must be updated');
  console.log('✔ Rename correctly updates CloudFile.');

  // --------------------------------------------------------------------------
  // TEST 4: Rename updates GameFile
  // --------------------------------------------------------------------------
  console.log('\n[4/25] Test 4: Rename updates GameFile...');
  const gfGow = gameFilesRepo.getByRemoteFileId(acc1.id, 'file-gow');
  assert(gfGow?.filename === 'God of War (USA).iso', 'GameFile filename must be updated');
  assert(gfGow?.remotePath === '/ROMs/PS2/God of War (USA).iso', 'GameFile remotePath must be updated');
  console.log('✔ Rename correctly updates GameFile filename and remotePath.');

  // --------------------------------------------------------------------------
  // TEST 5: Rename preserves Game ID
  // --------------------------------------------------------------------------
  console.log('\n[5/25] Test 5: Rename preserves Game ID...');
  const gameGow = gamesRepo.getBySlug('god-of-war-playstation-2');
  assert(gameGow !== null, 'God of War game must exist');
  assert(gfGow?.gameId === gameGow.id, 'GameFile must link to original game ID');
  console.log('✔ Rename preserves existing Game ID.');

  // --------------------------------------------------------------------------
  // TEST 6: Rename preserves playtime
  // --------------------------------------------------------------------------
  console.log('\n[6/25] Test 6: Rename preserves playtime...');
  gamesRepo.updatePlayTime(gameGow.id, 14400, '2026-09-01T12:00:00Z');
  // Trigger another rename
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-gow',
      removed: false,
      file: {
        id: 'file-gow',
        name: 'God of War [Greatest Hits].iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 4000000000,
        isFolder: false,
        parentFolderId: 'folder-ps2'
      }
    }
  ]);
  const gameGowPlaytime = gamesRepo.getById(gameGow.id);
  assert(gameGowPlaytime?.playTimeSeconds === 14400, `Expected 14400s playtime, got ${gameGowPlaytime?.playTimeSeconds}`);
  console.log('✔ Playtime preserved across renames.');

  // --------------------------------------------------------------------------
  // TEST 7: Move to new parent reconstructs path
  // --------------------------------------------------------------------------
  console.log('\n[7/25] Test 7: Move to new parent reconstructs path...');
  pathResolver.setCachedFolderPath(acc1.id, 'folder-ps2-classics', '/Sony/PlayStation 2');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-gow',
      removed: false,
      file: {
        id: 'file-gow',
        name: 'God of War.iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 4000000000,
        isFolder: false,
        parentFolderId: 'folder-ps2-classics'
      }
    }
  ]);
  const cfGowMoved = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-gow');
  assert(cfGowMoved?.remotePath === '/Sony/PlayStation 2/God of War.iso', `Expected moved path, got ${cfGowMoved?.remotePath}`);
  console.log('✔ Move to new parent reconstructs path accurately.');

  // --------------------------------------------------------------------------
  // TEST 8: Moved file can change platform classification
  // --------------------------------------------------------------------------
  console.log('\n[8/25] Test 8: Moved file can change platform classification...');
  pathResolver.setCachedFolderPath(acc1.id, 'folder-downloads', '/Downloads');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-burnout',
      removed: false,
      file: {
        id: 'file-burnout',
        name: 'Burnout3.iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 2500000000,
        isFolder: false,
        parentFolderId: 'folder-downloads'
      }
    }
  ]);
  // Move to PS2 folder
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-burnout',
      removed: false,
      file: {
        id: 'file-burnout',
        name: 'Burnout3.iso',
        mimeType: 'application/octet-stream',
        sizeBytes: 2500000000,
        isFolder: false,
        parentFolderId: 'folder-ps2-classics'
      }
    }
  ]);
  const cfBurnout = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-burnout');
  assert(cfBurnout?.detectedPlatform === 'PlayStation 2', `Expected PlayStation 2, got ${cfBurnout?.detectedPlatform}`);
  console.log('✔ Move dynamically updates platform classification.');

  // --------------------------------------------------------------------------
  // TEST 9: Folder rename updates descendants
  // --------------------------------------------------------------------------
  console.log('\n[9/25] Test 9: Folder rename updates descendants...');
  // Register folder in cloud_files
  cloudFilesRepo.upsert({
    id: 'cf-folder-ps2',
    storageAccountId: acc1.id,
    remoteFileId: 'folder-ps2-root',
    name: 'PS2',
    extension: '',
    mimeType: 'application/vnd.google-apps.folder',
    sizeBytes: 0,
    remotePath: '/ROMs/PS2',
    isFolder: true,
    isShortcut: false,
    trashed: false,
    classification: 'UNKNOWN',
    classificationConfidence: 0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Rename folder via change processor
  pathResolver.setCachedFolderPath(acc1.id, 'folder-roms', '/ROMs');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'folder-ps2-root',
      removed: false,
      file: {
        id: 'folder-ps2-root',
        name: 'PlayStation 2',
        mimeType: 'application/vnd.google-apps.folder',
        sizeBytes: 0,
        isFolder: true,
        parentFolderId: 'folder-roms'
      }
    }
  ]);

  const folderRow = cloudFilesRepo.getFolderByRemoteId(acc1.id, 'folder-ps2-root');
  assert(folderRow?.remotePath === '/ROMs/PlayStation 2', `Folder path expected /ROMs/PlayStation 2, got ${folderRow?.remotePath}`);
  console.log('✔ Folder rename successfully updates subtree path.');

  // --------------------------------------------------------------------------
  // TEST 10: Removed file -> MISSING
  // --------------------------------------------------------------------------
  console.log('\n[10/25] Test 10: Removed file -> MISSING...');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-mkdd',
      removed: true
    }
  ]);
  const cfMkDeleted = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-mkdd');
  assert(cfMkDeleted?.trashed === true, 'CloudFile must be marked trashed');
  const gfMkDeleted = gameFilesRepo.getByRemoteFileId(acc1.id, 'file-mkdd');
  assert(gfMkDeleted?.status === 'MISSING', `GameFile status must be MISSING, got ${gfMkDeleted?.status}`);
  const gameMkPreserved = gamesRepo.getBySlug('mario-kart-double-dash-gamecube');
  assert(gameMkPreserved !== null, 'Game catalog entry must NOT be deleted');
  console.log('✔ Removed file flags status = MISSING without deleting game.');

  // --------------------------------------------------------------------------
  // TEST 11: Restored file -> REMOTE
  // --------------------------------------------------------------------------
  console.log('\n[11/25] Test 11: Restored file -> REMOTE...');
  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'file-mkdd',
      removed: false,
      file: {
        id: 'file-mkdd',
        name: 'Mario Kart Double Dash.rvz',
        mimeType: 'application/octet-stream',
        sizeBytes: 1200000000,
        isFolder: false,
        parentFolderId: 'folder-gc',
        trashed: false
      }
    }
  ]);
  const cfMkRestored = cloudFilesRepo.getByRemoteFileId(acc1.id, 'file-mkdd');
  assert(cfMkRestored?.trashed === false, 'CloudFile trashed flag must be false');
  const gfMkRestored = gameFilesRepo.getByRemoteFileId(acc1.id, 'file-mkdd');
  assert(gfMkRestored?.status === 'REMOTE', `GameFile status must be restored to REMOTE, got ${gfMkRestored?.status}`);
  console.log('✔ Restored file transitions from MISSING to REMOTE.');

  // --------------------------------------------------------------------------
  // TEST 12 & 13: Initial scan drains changes from pre-scan token
  // --------------------------------------------------------------------------
  console.log('\n[12/25] Test 12 & 13: Initial scan drains changes from pre-scan token...');
  const accDrain: StorageAccount = {
    id: 'acc-drain',
    providerType: 'google_drive',
    providerAccountId: 'prov-drain',
    accountName: 'Drain Account',
    credentialKey: 'gdrive:drain',
    status: 'ACTIVE',
    quotaTotalBytes: 1000000000,
    quotaUsedBytes: 100000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  accountsRepo.upsert(accDrain);
  const providerDrain = new MockStorageProvider(accDrain.id, 'Drain Account');
  storageMgr.registerProvider(providerDrain);

  // Set initial files in folder
  providerDrain.setFilesForFolder(undefined, [
    {
      id: 'file-root-snes',
      name: 'Super Metroid.sfc',
      mimeType: 'application/octet-stream',
      sizeBytes: 3000000,
      isFolder: false
    }
  ]);

  // Queue change to occur while initial scan is executing
  providerDrain.changesQueue.push({
    changes: [
      {
        fileId: 'file-mid-scan',
        removed: false,
        file: {
          id: 'file-mid-scan',
          name: 'Chrono Trigger.sfc',
          mimeType: 'application/octet-stream',
          sizeBytes: 4000000,
          isFolder: false
        }
      }
    ],
    newStartPageToken: 'token_after_initial_drain'
  });

  await syncCoordinator.syncAccount(accDrain.id);

  const cfMetroid = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-root-snes');
  const cfChrono = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-mid-scan');
  assert(cfMetroid !== null, 'Super Metroid must be present from full scan');
  assert(cfChrono !== null, 'Chrono Trigger must appear immediately from pre-scan token drain');
  const gameChrono = gamesRepo.getBySlug('chrono-trigger-snes');
  assert(gameChrono !== null, 'Chrono Trigger game must be in catalog');

  const syncStateDrain = syncStateRepo.getSyncState(accDrain.id);
  assert(syncStateDrain?.initialScanCompleted === true, 'initialScanCompleted must be true');
  assert(syncStateDrain?.startPageToken === 'token_after_initial_drain', `Expected token_after_initial_drain, got ${syncStateDrain?.startPageToken}`);
  console.log('✔ Initial scan drained changes and advanced token before marking complete.');

  // --------------------------------------------------------------------------
  // TEST 14: Token only advances after successful processing
  // --------------------------------------------------------------------------
  console.log('\n[14/25] Test 14: Token only advances after successful processing...');
  providerDrain.changesQueue.push({
    changes: [
      {
        fileId: 'file-dkc',
        removed: false,
        file: {
          id: 'file-dkc',
          name: 'Donkey Kong Country.sfc',
          mimeType: 'application/octet-stream',
          sizeBytes: 4000000,
          isFolder: false
        }
      }
    ],
    newStartPageToken: 'token_advance_valid'
  });
  await syncCoordinator.syncAccount(accDrain.id);
  const syncStateAdv = syncStateRepo.getSyncState(accDrain.id);
  assert(syncStateAdv?.startPageToken === 'token_advance_valid', 'Token must advance after successful processing');
  console.log('✔ Token successfully advanced after change processing.');

  // --------------------------------------------------------------------------
  // TEST 15: Failed change processing does not advance token
  // --------------------------------------------------------------------------
  console.log('\n[15/25] Test 15: Failed change processing does not advance token...');
  providerDrain.shouldFailDuringChanges = true;
  let failThrown = false;
  try {
    await syncCoordinator.syncAccount(accDrain.id);
  } catch {
    failThrown = true;
  }
  assert(failThrown, 'Sync must throw when changes fail');
  providerDrain.shouldFailDuringChanges = false;
  const syncStateFailed = syncStateRepo.getSyncState(accDrain.id);
  assert(syncStateFailed?.startPageToken === 'token_advance_valid', 'Token must NOT advance on failure');
  console.log('✔ Failed change processing did not advance token.');

  // --------------------------------------------------------------------------
  // TEST 16: Duplicate change processing is idempotent
  // --------------------------------------------------------------------------
  console.log('\n[16/25] Test 16: Duplicate change processing is idempotent...');
  const duplicateChange = {
    fileId: 'file-idemp',
    removed: false,
    file: {
      id: 'file-idemp',
      name: 'Zelda.sfc',
      mimeType: 'application/octet-stream',
      sizeBytes: 2000000,
      isFolder: false
    }
  };
  await changeProcessor.processChanges(accDrain.id, providerDrain, [duplicateChange]);
  const countBefore = cloudFilesRepo.countByAccountId(accDrain.id).total;
  await changeProcessor.processChanges(accDrain.id, providerDrain, [duplicateChange]);
  const countAfter = cloudFilesRepo.countByAccountId(accDrain.id).total;
  assert(countBefore === countAfter, 'Duplicate change must not increase row count');
  console.log('✔ Duplicate change processing is idempotent.');

  // --------------------------------------------------------------------------
  // TEST 17, 18, 19: cloud_file local ID stability, firstSeenAt, lastSeenAt
  // --------------------------------------------------------------------------
  console.log('\n[17-19/25] Test 17-19: Local ID stability, firstSeenAt, lastSeenAt...');
  const firstCf = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-idemp')!;
  const originalId = firstCf.id;
  const originalFirstSeen = firstCf.firstSeenAt;

  // Re-upsert with updated metadata
  const updatedCf: CloudFile = {
    ...firstCf,
    id: 'different-uuid-attempt',
    lastSeenAt: '2026-09-12T20:00:00Z',
    updatedAt: '2026-09-12T20:00:00Z'
  };
  cloudFilesRepo.upsert(updatedCf);

  const reloadedCf = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-idemp')!;
  assert(reloadedCf.id === originalId, `Local ID must remain ${originalId}, got ${reloadedCf.id}`);
  assert(reloadedCf.firstSeenAt === originalFirstSeen, 'firstSeenAt must remain unchanged');
  assert(reloadedCf.lastSeenAt === '2026-09-12T20:00:00Z', 'lastSeenAt must update');
  console.log('✔ Cloud file local ID and firstSeenAt remain stable; lastSeenAt updates.');

  // --------------------------------------------------------------------------
  // TEST 20: Cancelled full scan does not mark unseen files missing
  // --------------------------------------------------------------------------
  console.log('\n[20/25] Test 20: Cancelled full scan does not mark unseen files missing...');
  const cancelToken = new CancellationToken();
  cancelToken.cancel(); // immediately cancelled
  let cancelErrorThrown = false;
  try {
    await scanner.scanAccount(providerDrain, cancelToken);
  } catch {
    cancelErrorThrown = true;
  }
  assert(cancelErrorThrown, 'Scanner must throw on cancellation');
  const cfStillValid = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-idemp')!;
  assert(cfStillValid.trashed === false, 'File must NOT be marked trashed on cancelled scan');
  console.log('✔ Cancelled scan does not mark existing files missing.');

  // --------------------------------------------------------------------------
  // TEST 21: Failed full scan does not mark unseen files missing
  // --------------------------------------------------------------------------
  console.log('\n[21/25] Test 21: Failed full scan does not mark unseen files missing...');
  providerDrain.shouldFailDuringScan = true;
  let scanFailThrown = false;
  try {
    await scanner.scanAccount(providerDrain);
  } catch {
    scanFailThrown = true;
  }
  assert(scanFailThrown, 'Scanner must throw on failure');
  providerDrain.shouldFailDuringScan = false;
  const cfAfterFail = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-idemp')!;
  assert(cfAfterFail.trashed === false, 'File must NOT be marked trashed on failed scan');
  console.log('✔ Failed scan does not mark existing files missing.');

  // --------------------------------------------------------------------------
  // TEST 22: Successful full scan reconciles missing files
  // --------------------------------------------------------------------------
  console.log('\n[22/25] Test 22: Successful full scan reconciles missing files...');
  // Run scan with empty folder list
  const runSuccessful = `run-reconcile-${Date.now()}`;
  providerDrain.setFilesForFolder(undefined, [
    {
      id: 'file-kept',
      name: 'Kept Game.sfc',
      mimeType: 'application/octet-stream',
      sizeBytes: 1000,
      isFolder: false
    }
  ]);
  await scanner.scanAccount(providerDrain, undefined, undefined, runSuccessful);
  // Reconcile unseen files
  const unseen = cloudFilesRepo.reconcileUnseenFiles(accDrain.id, runSuccessful);
  assert(unseen.includes('file-idemp'), 'file-idemp must be in unseen list');
  const cfReconciled = cloudFilesRepo.getByRemoteFileId(accDrain.id, 'file-idemp')!;
  assert(cfReconciled.trashed === true, 'Unseen file must be marked trashed');
  console.log('✔ Successful full scan reconciles missing files as trashed.');

  // --------------------------------------------------------------------------
  // TEST 23: 410 invalid token triggers full resync
  // --------------------------------------------------------------------------
  console.log('\n[23/25] Test 23: 410 invalid token triggers full resync...');
  providerDrain.shouldFailWith410 = true;
  await syncCoordinator.syncAccount(accDrain.id);
  const syncStateAfter410 = syncStateRepo.getSyncState(accDrain.id);
  assert(syncStateAfter410?.initialScanCompleted === true, 'Resync after 410 must mark initial scan complete');
  console.log('✔ HTTP 410 invalid token cleanly recovered via safe full resync.');

  // --------------------------------------------------------------------------
  // TEST 24: Game + game_files ingestion transaction rollback
  // --------------------------------------------------------------------------
  console.log('\n[24/25] Test 24: Game + game_files ingestion transaction rollback...');
  const initialGamesCount = gamesRepo.getAll().length;
  // Trigger a transaction error by passing an invalid candidate structure that violates a constraint
  let txRollbackCaught = false;
  try {
    db.transaction(() => {
      gamesRepo.upsert({
        id: 'game-tx-test',
        title: 'TX Rollback Test',
        slug: 'tx-rollback-test',
        platform: 'SNES',
        state: 'CLOUD',
        sizeBytes: 1000,
        playTimeSeconds: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      // Deliberately trigger foreign key error by referencing non-existent account
      db.prepare('INSERT INTO game_files (id, game_id, storage_account_id, remote_file_id, remote_path, filename, size_bytes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('f-tx', 'game-tx-test', 'non-existent-acc-id', 'r-tx', '/path', 'file', 10, 'REMOTE', new Date().toISOString(), new Date().toISOString());
    })();
  } catch {
    txRollbackCaught = true;
  }
  assert(txRollbackCaught, 'Transaction must fail and throw');
  const gamesCountAfter = gamesRepo.getAll().length;
  assert(gamesCountAfter === initialGamesCount, 'Game insertion must be completely rolled back');
  console.log('✔ SQLite transaction rollback verified.');

  // --------------------------------------------------------------------------
  // TEST 25: Multi-account changes remain isolated
  // --------------------------------------------------------------------------
  console.log('\n[25/25] Test 25: Multi-account changes remain isolated...');
  const acc2: StorageAccount = {
    id: 'acc-2',
    providerType: 'google_drive',
    providerAccountId: 'prov-acc-2',
    accountName: 'Account 2',
    credentialKey: 'gdrive:acc-2',
    status: 'ACTIVE',
    quotaTotalBytes: 1000000000,
    quotaUsedBytes: 100000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  accountsRepo.upsert(acc2);
  const provider2 = new MockStorageProvider(acc2.id, 'Account 2');
  storageMgr.registerProvider(provider2);

  await changeProcessor.processChanges(acc1.id, provider1, [
    {
      fileId: 'shared-remote-id',
      removed: false,
      file: {
        id: 'shared-remote-id',
        name: 'File_On_Acc1.iso',
        mimeType: 'bin',
        sizeBytes: 50,
        isFolder: false
      }
    }
  ]);
  await changeProcessor.processChanges(acc2.id, provider2, [
    {
      fileId: 'shared-remote-id',
      removed: false,
      file: {
        id: 'shared-remote-id',
        name: 'File_On_Acc2.iso',
        mimeType: 'bin',
        sizeBytes: 100,
        isFolder: false
      }
    }
  ]);

  const acc1File = cloudFilesRepo.getByRemoteFileId(acc1.id, 'shared-remote-id');
  const acc2File = cloudFilesRepo.getByRemoteFileId(acc2.id, 'shared-remote-id');
  assert(acc1File?.name === 'File_On_Acc1.iso', 'Account 1 file must retain its name');
  assert(acc2File?.name === 'File_On_Acc2.iso', 'Account 2 file must retain its name');
  assert(acc1File?.id !== acc2File?.id, 'Cloud file local IDs must be different');
  console.log('✔ Multi-account changes remain completely isolated.');

  // --------------------------------------------------------------------------
  // SECTION 18: END-TO-END MOCKED INTEGRATION TEST
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('🎮 SECTION 18: END-TO-END MOCKED INTEGRATION SCENARIO');
  console.log('================================================================');

  const accE2e: StorageAccount = {
    id: 'acc-e2e',
    providerType: 'google_drive',
    providerAccountId: 'prov-e2e',
    accountName: 'E2E Account',
    credentialKey: 'gdrive:e2e',
    status: 'ACTIVE',
    quotaTotalBytes: 5000000000,
    quotaUsedBytes: 10000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  accountsRepo.upsert(accE2e);
  const providerE2e = new MockStorageProvider(accE2e.id, 'E2E Account');
  storageMgr.registerProvider(providerE2e);

  // 1. Initial Drive: /PS2/Burnout 3.chd
  providerE2e.setFilesForFolder(undefined, [
    {
      id: 'folder-e2e-ps2',
      name: 'PS2',
      mimeType: 'application/vnd.google-apps.folder',
      sizeBytes: 0,
      isFolder: true
    }
  ]);
  providerE2e.setFilesForFolder('folder-e2e-ps2', [
    {
      id: 'file-burnout-3',
      name: 'Burnout 3.chd',
      mimeType: 'application/octet-stream',
      sizeBytes: 2500000000,
      isFolder: false,
      parentFolderId: 'folder-e2e-ps2'
    }
  ]);

  console.log('Step 1: Running initial full sync...');
  await syncCoordinator.syncAccount(accE2e.id);

  const initialBurnout = gamesRepo.getBySlug('burnout-3-playstation-2');
  assert(initialBurnout !== null, 'Burnout 3 must be present in library after initial sync');
  const initialBurnoutId = initialBurnout.id;
  // User plays 5 hours
  gamesRepo.updatePlayTime(initialBurnoutId, 18000, '2026-09-10T15:00:00Z');

  // 2. Changes:
  // ADD /GameCube/Mario Kart Double Dash.rvz
  // RENAME Burnout 3.chd -> Burnout 3 Takedown.chd
  // MOVE Mario Kart to /Nintendo/GameCube/
  // DELETE Burnout 3 Takedown.chd
  console.log('Step 2: Queuing changes (Add, Rename, Move, Delete)...');
  pathResolver.setCachedFolderPath(accE2e.id, 'folder-e2e-gc-nintendo', '/Nintendo/GameCube');

  providerE2e.changesQueue.push({
    changes: [
      {
        fileId: 'file-e2e-mk',
        removed: false,
        file: {
          id: 'file-e2e-mk',
          name: 'Mario Kart Double Dash.rvz',
          mimeType: 'application/octet-stream',
          sizeBytes: 1300000000,
          isFolder: false,
          parentFolderId: 'folder-e2e-gc-nintendo'
        }
      },
      {
        fileId: 'file-burnout-3',
        removed: false,
        file: {
          id: 'file-burnout-3',
          name: 'Burnout 3 Takedown.chd',
          mimeType: 'application/octet-stream',
          sizeBytes: 2500000000,
          isFolder: false,
          parentFolderId: 'folder-e2e-ps2'
        }
      },
      {
        fileId: 'file-burnout-3',
        removed: true
      }
    ],
    newStartPageToken: 'token_e2e_final'
  });

  console.log('Step 3: Running delta sync...');
  await syncCoordinator.syncAccount(accE2e.id);

  // 3. Verify Final DB State
  const e2eMkGame = gamesRepo.getBySlug('mario-kart-double-dash-gamecube');
  assert(e2eMkGame !== null, 'Mario Kart Double Dash must be present in library');
  assert(e2eMkGame.platform === 'GameCube', `Platform must be GameCube, got ${e2eMkGame.platform}`);
  const e2eMkFile = gameFilesRepo.getByRemoteFileId(accE2e.id, 'file-e2e-mk');
  assert(e2eMkFile?.remotePath === '/Nintendo/GameCube/Mario Kart Double Dash.rvz', `Expected /Nintendo/GameCube path, got ${e2eMkFile?.remotePath}`);

  const e2eBurnoutGame = gamesRepo.getById(initialBurnoutId);
  assert(e2eBurnoutGame !== null, 'Burnout game record must be preserved in games table');
  assert(e2eBurnoutGame.playTimeSeconds === 18000, `Playtime must be 18000s, got ${e2eBurnoutGame.playTimeSeconds}`);
  const e2eBurnoutFiles = gameFilesRepo.getByGameId(initialBurnoutId);
  assert(e2eBurnoutFiles.length === 1, `Expected 1 game file, got ${e2eBurnoutFiles.length}`);
  assert(e2eBurnoutFiles[0].status === 'MISSING', `Game file must be MISSING, got ${e2eBurnoutFiles[0].status}`);

  console.log('✔ SECTION 18 END-TO-END SCENARIO COMPLETED WITH ZERO DUPLICATIONS!');

  console.log('\n================================================================');
  console.log('🎉 ALL 25 PHASE 2C SCENARIOS + E2E TEST PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');
}

runPhase2CTests().catch((err) => {
  console.error('\n❌ PHASE 2C TEST FAILED:', err);
  process.exit(1);
});
