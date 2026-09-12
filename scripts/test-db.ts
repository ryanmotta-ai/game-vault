import Database from 'better-sqlite3';
import { initializeDatabaseSchema, MIGRATIONS } from '../src/database/schema';
import { MigrationRunner } from '../src/database/migrations/migrationRunner';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { DownloadsRepository } from '../src/database/repositories/downloadsRepository';
import { EmulatorsRepository } from '../src/database/repositories/emulatorsRepository';
import { SettingsRepository } from '../src/database/repositories/settingsRepository';
import { MemoryCredentialStore, DpapiCredentialStore } from '../src/core/security/CredentialStore';
import { GoogleOAuthService } from '../src/providers/google-drive/GoogleOAuthService';
import { StorageManager } from '../src/storage/StorageManager';
import { StorageAccount } from '../src/core/types';

console.log('================================================================');
console.log('🎮 GAME VAULT - FASE 2A DATABASE & AUTHENTICATION INTEGRITY TESTS');
console.log('================================================================\n');

async function runTests() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // --------------------------------------------------------------------------
  // TEST 1: Schema Migrations & Idempotency
  // --------------------------------------------------------------------------
  console.log('[1/9] Testing versioned migration runner & idempotency...');
  initializeDatabaseSchema(db);

  const appliedMigrations = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number; name: string }>;
  if (appliedMigrations.length < 2) {
    throw new Error(`Expected at least 2 migrations applied, found: ${appliedMigrations.length}`);
  }
  if (appliedMigrations[0].version !== 1 || appliedMigrations[1].version !== 2) {
    throw new Error('Migration version order mismatch in schema_migrations');
  }

  // Test idempotency (running again must not error or duplicate)
  const runner = new MigrationRunner(db);
  runner.runMigrations(MIGRATIONS);
  const rechecked = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number };
  if (rechecked.count !== appliedMigrations.length) {
    throw new Error('Migrations are not idempotent! Duplicate entries found.');
  }

  // Verify columns in storage_accounts
  const tableInfo = db.prepare("PRAGMA table_info('storage_accounts')").all() as Array<{ name: string }>;
  const colNames = tableInfo.map((c) => c.name);
  const requiredCols = ['provider_account_id', 'credential_key', 'last_authenticated_at'];
  for (const col of requiredCols) {
    if (!colNames.includes(col)) {
      throw new Error(`Column ${col} missing from storage_accounts table`);
    }
  }
  console.log('✔ Schema migrations 001 and 002 applied idempotently with required columns.');

  // --------------------------------------------------------------------------
  // TEST 2: StorageAccountsRepository v2
  // --------------------------------------------------------------------------
  console.log('\n[2/9] Testing StorageAccountsRepository (v2 columns & queries)...');
  const accountsRepo = new StorageAccountsRepository(db);
  accountsRepo.upsert({
    id: 'test-gdrive-primary',
    providerType: 'google_drive',
    providerAccountId: 'google-user-10001',
    credentialKey: 'google_drive:test-gdrive-primary',
    accountName: 'Ryan Principal 5 TB',
    accountEmail: 'ryan.primary@gmail.com',
    status: 'ACTIVE',
    quotaTotalBytes: 5497558138880, // 5 TB
    quotaUsedBytes: 2199023255552,  // 2 TB
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAuthenticatedAt: new Date().toISOString()
  });

  const primaryAcc = accountsRepo.getById('test-gdrive-primary');
  if (!primaryAcc || primaryAcc.providerAccountId !== 'google-user-10001' || primaryAcc.credentialKey !== 'google_drive:test-gdrive-primary') {
    throw new Error('Failed to retrieve storage account with v2 attributes');
  }

  const foundByProviderId = accountsRepo.getByProviderAccountId('google_drive', 'google-user-10001');
  if (!foundByProviderId || foundByProviderId.id !== 'test-gdrive-primary') {
    throw new Error('getByProviderAccountId failed to find matching account');
  }

  accountsRepo.updateQuota('test-gdrive-primary', 5497558138880, 2500000000000);
  const updatedAcc = accountsRepo.getById('test-gdrive-primary');
  if (updatedAcc?.quotaUsedBytes !== 2500000000000) {
    throw new Error('updateQuota failed');
  }

  accountsRepo.updateStatus('test-gdrive-primary', 'DISCONNECTED');
  if (accountsRepo.getById('test-gdrive-primary')?.status !== 'DISCONNECTED') {
    throw new Error('updateStatus failed');
  }
  accountsRepo.updateStatus('test-gdrive-primary', 'ACTIVE');
  console.log('✔ StorageAccountsRepository verified with providerAccountId and credentialKey.');

  // --------------------------------------------------------------------------
  // TEST 3: CredentialStore Security (DPAPI + Fallback & Memory)
  // --------------------------------------------------------------------------
  console.log('\n[3/9] Testing CredentialStore (Memory & DPAPI/Fallback encryption)...');
  const memStore = new MemoryCredentialStore();
  const testTokens = {
    accessToken: 'ya29.a0AfH6SMB_test_access_token_mock',
    refreshToken: '1//0g_test_refresh_token_mock',
    expiryDate: Date.now() + 3600000
  };

  await memStore.setTokenPayload('acc-key-1', testTokens);
  if (!(await memStore.has('acc-key-1'))) {
    throw new Error('MemoryCredentialStore.has() returned false for stored key');
  }
  const retrievedMem = await memStore.getTokenPayload('acc-key-1');
  if (retrievedMem?.refreshToken !== testTokens.refreshToken || retrievedMem?.accessToken !== testTokens.accessToken) {
    throw new Error('MemoryCredentialStore round-trip failed');
  }
  await memStore.delete('acc-key-1');
  if (await memStore.has('acc-key-1') || (await memStore.getTokenPayload('acc-key-1')) !== null) {
    throw new Error('MemoryCredentialStore.delete() failed');
  }

  // Verify fail-secure behavior when safeStorage is unavailable without fallback
  let failSecureThrown = false;
  try {
    const strictStore = new DpapiCredentialStore({ allowInsecureFallback: false });
    await strictStore.setTokenPayload('test-strict', testTokens);
  } catch {
    failSecureThrown = true;
  }
  if (!failSecureThrown) {
    throw new Error('DpapiCredentialStore should fail secure when safeStorage is unavailable and allowInsecureFallback=false');
  }

  const dpapiStore = new DpapiCredentialStore({ allowInsecureFallback: true });
  await dpapiStore.setTokenPayload('test-storage-key', testTokens);
  if (!(await dpapiStore.has('test-storage-key'))) {
    throw new Error('DpapiCredentialStore.has() returned false after save');
  }
  const retrievedDpapi = await dpapiStore.getTokenPayload('test-storage-key');
  if (!retrievedDpapi || retrievedDpapi.refreshToken !== testTokens.refreshToken || retrievedDpapi.accessToken !== testTokens.accessToken) {
    throw new Error('DpapiCredentialStore encryption round-trip failed to match tokens');
  }
  await dpapiStore.delete('test-storage-key');
  if (await dpapiStore.has('test-storage-key') || (await dpapiStore.getTokenPayload('test-storage-key')) !== null) {
    throw new Error('DpapiCredentialStore delete failed');
  }
  console.log('✔ CredentialStore encryption, fail-secure policy, round-trip retrieval, and deletion validated.');

  // --------------------------------------------------------------------------
  // TEST 4: OAuth PKCE Generation & RFC 7636 Conformance
  // --------------------------------------------------------------------------
  console.log('\n[4/9] Testing Google OAuth PKCE generation (RFC 7636 S256)...');
  const verifier = GoogleOAuthService.generateCodeVerifier();
  if (!verifier || verifier.length < 43 || verifier.length > 128) {
    throw new Error(`PKCE code_verifier length (${verifier?.length}) must be between 43 and 128 chars`);
  }
  // Base64url character set test
  if (!/^[A-Za-z0-9_-]+$/.test(verifier)) {
    throw new Error('PKCE code_verifier contains invalid characters outside [A-Za-z0-9_-]');
  }

  const challenge = GoogleOAuthService.generateCodeChallenge(verifier);
  if (!challenge || challenge.length !== 43) {
    throw new Error(`PKCE code_challenge invalid length: ${challenge?.length}`);
  }

  // Test RFC 7636 Appendix B official test vector:
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const computedChallenge = GoogleOAuthService.generateCodeChallenge(rfcVerifier);
  if (computedChallenge !== expectedChallenge) {
    throw new Error(`RFC 7636 test vector failed: expected ${expectedChallenge}, got ${computedChallenge}`);
  }
  console.log('✔ OAuth PKCE generator conforms with RFC 7636 Appendix B test vector.');

  // --------------------------------------------------------------------------
  // TEST 5: Multi-Account Storage Foundation
  // --------------------------------------------------------------------------
  console.log('\n[5/9] Testing Multi-Account Storage Manager & Quota Aggregation...');
  const storageManager = StorageManager.getInstance();
  storageManager.setRepository(accountsRepo);

  const accountA: StorageAccount = {
    id: 'gdrive-acc-a',
    providerType: 'google_drive',
    providerAccountId: 'google-user-ryan-main',
    credentialKey: 'google_drive:gdrive-acc-a',
    accountName: 'Ryan Principal 5 TB',
    accountEmail: 'ryan.main@gmail.com',
    status: 'ACTIVE',
    quotaTotalBytes: 5000000000000,
    quotaUsedBytes: 2000000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAuthenticatedAt: new Date().toISOString()
  };

  const accountB: StorageAccount = {
    id: 'gdrive-acc-b',
    providerType: 'google_drive',
    providerAccountId: 'google-user-ryan-archive',
    credentialKey: 'google_drive:gdrive-acc-b',
    accountName: 'Ryan Archive 5 TB',
    accountEmail: 'ryan.archive@gmail.com',
    status: 'ACTIVE',
    quotaTotalBytes: 5000000000000,
    quotaUsedBytes: 3000000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAuthenticatedAt: new Date().toISOString()
  };

  accountsRepo.upsert(accountA);
  accountsRepo.upsert(accountB);

  storageManager.registerProvider(accountA);
  storageManager.registerProvider(accountB);

  if (!storageManager.hasProvider(accountA.id) || !storageManager.hasProvider(accountB.id)) {
    throw new Error('StorageManager failed to register both accounts concurrently');
  }

  if (storageManager.getActiveAccountsCount() !== 2) {
    throw new Error(`Expected 2 active accounts, got: ${storageManager.getActiveAccountsCount()}`);
  }

  const quotaSummary2Acc = await storageManager.getQuotaSummary([accountA, accountB]);
  if (quotaSummary2Acc.cloudTotalBytes !== 10000000000000) {
    throw new Error(`Aggregated cloudTotalBytes expected 10TB, got ${quotaSummary2Acc.cloudTotalBytes}`);
  }
  if (quotaSummary2Acc.cloudUsedBytes !== 5000000000000) {
    throw new Error(`Aggregated cloudUsedBytes expected 5TB, got ${quotaSummary2Acc.cloudUsedBytes}`);
  }
  if (quotaSummary2Acc.connectedAccountsCount !== 2) {
    throw new Error(`Aggregated connectedAccountsCount expected 2, got ${quotaSummary2Acc.connectedAccountsCount}`);
  }

  // Disconnect Account A and verify Account B remains completely untouched
  await storageManager.disconnectAccount(accountA.id);
  if (storageManager.hasProvider(accountA.id)) {
    throw new Error('Account A was not removed from StorageManager upon disconnect');
  }
  if (!storageManager.hasProvider(accountB.id)) {
    throw new Error('Account B was incorrectly removed when disconnecting Account A!');
  }

  const disconnectedAccountA = accountsRepo.getById(accountA.id);
  if (disconnectedAccountA?.status !== 'DISCONNECTED') {
    throw new Error('Account A status was not updated to DISCONNECTED in repository');
  }

  const quotaSummary1Acc = await storageManager.getQuotaSummary([disconnectedAccountA!, accountB]);
  if (quotaSummary1Acc.cloudTotalBytes !== 5000000000000 || quotaSummary1Acc.cloudUsedBytes !== 3000000000000 || quotaSummary1Acc.connectedAccountsCount !== 1) {
    throw new Error('Quota aggregation did not reflect single remaining connected account');
  }
  console.log('✔ Multi-account registration, isolated disconnect, and quota aggregation validated.');

  // --------------------------------------------------------------------------
  // TEST 6: GamesRepository & States (CLOUD, DOWNLOADING, READY)
  // --------------------------------------------------------------------------
  console.log('\n[6/9] Testing GamesRepository & states (CLOUD, DOWNLOADING, READY)...');
  const gamesRepo = new GamesRepository(db);
  gamesRepo.upsert({
    id: 'game-zelda',
    title: 'The Legend of Zelda: Breath of the Wild',
    slug: 'zelda-botw',
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

  // --------------------------------------------------------------------------
  // TEST 7: GameFilesRepository Multi-Account Mapping
  // --------------------------------------------------------------------------
  console.log('\n[7/9] Testing GameFilesRepository multi-account association...');
  const filesRepo = new GameFilesRepository(db);
  filesRepo.upsert({
    id: 'file-zelda-rom',
    gameId: 'game-zelda',
    storageAccountId: accountB.id,
    remoteFileId: 'gdrive-file-archive-9988',
    remotePath: '/Games/Switch/zelda.nsp',
    filename: 'zelda.nsp',
    sizeBytes: 16000000000,
    status: 'REMOTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const gameFiles = filesRepo.getByGameId('game-zelda');
  if (gameFiles.length !== 1 || gameFiles[0].remoteFileId !== 'gdrive-file-archive-9988') {
    throw new Error('GameFilesRepository validation failed');
  }
  console.log('✔ Game file mapped to secondary storage account verified.');

  // --------------------------------------------------------------------------
  // TEST 8: DownloadsRepository & Emulators & Settings
  // --------------------------------------------------------------------------
  console.log('\n[8/9] Testing Downloads, Emulators, & Settings Repositories...');
  const dlRepo = new DownloadsRepository(db);
  dlRepo.upsert({
    id: 'dl-001',
    gameId: 'game-zelda',
    storageAccountId: accountB.id,
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

  const emuRepo = new EmulatorsRepository(db);
  emuRepo.upsert({
    id: 'ryujinx',
    name: 'Ryujinx',
    platform: 'Nintendo Switch',
    executablePath: 'C:\\Emulators\\Ryujinx\\Ryujinx.exe',
    isInstalled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const emus = emuRepo.getByPlatform('Nintendo Switch');
  if (emus.length !== 1 || emus[0].name !== 'Ryujinx') {
    throw new Error('EmulatorsRepository validation failed');
  }

  const settingsRepo = new SettingsRepository(db);
  settingsRepo.set('theme', 'dark');
  settingsRepo.set('maxDownloads', 4);
  settingsRepo.set('oauthConfig', { configured: true, provider: 'google_drive' });

  const oauthSetting = settingsRepo.get<{ configured: boolean; provider: string }>('oauthConfig');
  if (
    settingsRepo.get('theme') !== 'dark' ||
    settingsRepo.get('maxDownloads') !== 4 ||
    !oauthSetting?.configured
  ) {
    throw new Error('SettingsRepository validation failed');
  }
  console.log('✔ Downloads, Emulators, and Settings repositories validated.');

  // --------------------------------------------------------------------------
  // TEST 9: Foreign Key Constraints Enforcement
  // --------------------------------------------------------------------------
  console.log('\n[9/9] Testing Foreign Key Constraints Enforcement...');
  let fkErrorCaught = false;
  try {
    filesRepo.upsert({
      id: 'invalid-file',
      gameId: 'non-existent-game-id',
      storageAccountId: accountB.id,
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
  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 2A TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');
}

runTests().catch((error) => {
  console.error('\n❌ DATABASE / AUTHENTICATION TEST FAILED:', error);
  process.exit(1);
});

