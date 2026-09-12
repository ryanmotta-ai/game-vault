import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { DownloadsRepository } from '../src/database/repositories/downloadsRepository';
import { EmulatorsRepository } from '../src/database/repositories/emulatorsRepository';
import { SettingsRepository } from '../src/database/repositories/settingsRepository';

console.log('=== RUNNING GAME VAULT DATABASE INTEGRITY TESTS ===\n');

try {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  console.log('[1/7] Testing schema migration...');
  initializeDatabaseSchema(db);
  console.log('✔ Schema initialized without error.');

  console.log('\n[2/7] Testing StorageAccountsRepository...');
  const accountsRepo = new StorageAccountsRepository(db);
  accountsRepo.upsert({
    id: 'test-gdrive-1',
    providerType: 'google_drive',
    accountName: 'Test Google Drive',
    accountEmail: 'user@test.com',
    status: 'ACTIVE',
    quotaTotalBytes: 15000000000,
    quotaUsedBytes: 5000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const accounts = accountsRepo.getAll();
  if (accounts.length !== 1 || accounts[0].accountName !== 'Test Google Drive') {
    throw new Error('StorageAccountsRepository validation failed');
  }
  console.log('✔ Storage account inserted and queried successfully.');

  console.log('\n[3/7] Testing GamesRepository & states (CLOUD, DOWNLOADING, READY)...');
  const gamesRepo = new GamesRepository(db);
  gamesRepo.upsert({
    id: 'game-zelda',
    title: 'The Legend of Zelda',
    slug: 'zelda',
    platform: 'Nintendo Switch',
    state: 'CLOUD',
    sizeBytes: 16000000000,
    playTimeSeconds: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  gamesRepo.upsert({
    id: 'game-cp2077',
    title: 'Cyberpunk 2077',
    slug: 'cyberpunk-2077',
    platform: 'PC',
    state: 'READY',
    sizeBytes: 70000000000,
    playTimeSeconds: 3600,
    installedPath: 'C:\\Games\\CP2077\\bin\\x64\\cp.exe',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const allGames = gamesRepo.getAll();
  const readyGames = gamesRepo.getByState('READY');
  const cloudGames = gamesRepo.getByState('CLOUD');

  if (allGames.length !== 2 || readyGames.length !== 1 || cloudGames.length !== 1) {
    throw new Error('GamesRepository state querying failed');
  }
  console.log('✔ Games inserted and filtered by state successfully.');

  console.log('\n[4/7] Testing GameFilesRepository...');
  const filesRepo = new GameFilesRepository(db);
  filesRepo.upsert({
    id: 'file-zelda-rom',
    gameId: 'game-zelda',
    storageAccountId: 'test-gdrive-1',
    remoteFileId: 'gdrive-file-12345',
    remotePath: '/Games/Switch/zelda.nsp',
    filename: 'zelda.nsp',
    sizeBytes: 16000000000,
    status: 'REMOTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const gameFiles = filesRepo.getByGameId('game-zelda');
  if (gameFiles.length !== 1 || gameFiles[0].remoteFileId !== 'gdrive-file-12345') {
    throw new Error('GameFilesRepository validation failed');
  }
  console.log('✔ Game file mapped and verified.');

  console.log('\n[5/7] Testing DownloadsRepository...');
  const dlRepo = new DownloadsRepository(db);
  dlRepo.upsert({
    id: 'dl-001',
    gameId: 'game-zelda',
    storageAccountId: 'test-gdrive-1',
    status: 'DOWNLOADING',
    totalBytes: 16000000000,
    downloadedBytes: 4000000000,
    downloadSpeedBps: 25000000,
    createdAt: new Date().toISOString()
  });

  const activeDownloads = dlRepo.getActive();
  if (activeDownloads.length !== 1 || activeDownloads[0].id !== 'dl-001') {
    throw new Error('DownloadsRepository validation failed');
  }
  console.log('✔ Downloads queue recorded and queried successfully.');

  console.log('\n[6/7] Testing EmulatorsRepository & SettingsRepository...');
  const emuRepo = new EmulatorsRepository(db);
  emuRepo.upsert({
    id: 'pcsx2',
    name: 'PCSX2',
    platform: 'PlayStation 2',
    executablePath: 'C:\\Emulators\\PCSX2\\pcsx2-qt.exe',
    isInstalled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const emus = emuRepo.getByPlatform('PlayStation 2');
  if (emus.length !== 1 || emus[0].name !== 'PCSX2') {
    throw new Error('EmulatorsRepository validation failed');
  }

  const settingsRepo = new SettingsRepository(db);
  settingsRepo.set('theme', 'dark');
  settingsRepo.set('maxDownloads', 3);
  settingsRepo.set('customObj', { speedLimit: 5000 });

  const customObj = settingsRepo.get<{ speedLimit: number }>('customObj');
  if (
    settingsRepo.get('theme') !== 'dark' ||
    settingsRepo.get('maxDownloads') !== 3 ||
    customObj?.speedLimit !== 5000
  ) {
    throw new Error('SettingsRepository JSON serialization validation failed');
  }
  console.log('✔ Emulators and Settings repositories validated.');

  console.log('\n[7/7] Testing Foreign Key Constraints Enforcement...');
  let fkErrorCaught = false;
  try {
    filesRepo.upsert({
      id: 'invalid-file',
      gameId: 'non-existent-game-id',
      storageAccountId: 'test-gdrive-1',
      remoteFileId: 'invalid',
      remotePath: '/invalid',
      filename: 'test.iso',
      sizeBytes: 100,
      status: 'REMOTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch {
    fkErrorCaught = true;
    console.log('✔ Foreign key constraint successfully prevented orphaned file insertion.');
  }

  if (!fkErrorCaught) {
    throw new Error('Foreign key constraint was NOT enforced!');
  }

  db.close();
  console.log('\n======================================================');
  console.log('🎉 ALL DATABASE TESTS PASSED WITH 100% SUCCESS!');
  console.log('======================================================\n');
  process.exit(0);
} catch (error) {
  console.error('\n❌ DATABASE TEST FAILED:', error);
  process.exit(1);
}
