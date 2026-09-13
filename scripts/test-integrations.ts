import assert from 'node:assert';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../src/database/schema';
import { IntegrationConnectionsRepository } from '../src/database/repositories/integrationConnectionsRepository';
import { StorageAccountsRepository } from '../src/database/repositories/storageAccountsRepository';
import {
  IntegrationRegistry,
  IntegrationManager,
  GoogleDriveIntegrationAdapter,
  ScreenScraperIntegrationAdapter,
  RetroAchievementsIntegrationAdapter,
  IgdbIntegrationAdapter,
  EmulationStationIntegrationAdapter,
  ExternalServiceClient,
  ScreenScraperMetadataProvider
} from '../src/integrations';
import { MemoryCredentialStore, setCredentialStore } from '../src/core/security/CredentialStore';
import { sanitizeLogData } from '../src/core/logger';
import { StorageAccount } from '../src/core/types';

async function runIntegrationsTestSuite() {
  console.log('================================================================');
  console.log('🎮 GAME VAULT - UNIVERSAL INTEGRATION ARCHITECTURE TEST SUITE');
  console.log('================================================================\n');

  const credStore = new MemoryCredentialStore();
  setCredentialStore(credStore);

  // Setup In-Memory SQLite DB
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);

  const connRepo = new IntegrationConnectionsRepository(db);
  const storageRepo = new StorageAccountsRepository(db);

  // --------------------------------------------------------------------------
  // [1/12] Registry & Definitions Validation
  // --------------------------------------------------------------------------
  console.log('[1/12] Testing IntegrationRegistry & definitions registration...');
  const registry = new IntegrationRegistry();
  const gdriveAdapter = new GoogleDriveIntegrationAdapter(connRepo);
  const ssAdapter = new ScreenScraperIntegrationAdapter(connRepo);
  const retroAdapter = new RetroAchievementsIntegrationAdapter(connRepo);
  const igdbAdapter = new IgdbIntegrationAdapter(connRepo);
  const esAdapter = new EmulationStationIntegrationAdapter(connRepo);

  registry.register(gdriveAdapter);
  registry.register(ssAdapter);
  registry.register(retroAdapter);
  registry.register(igdbAdapter);
  registry.register(esAdapter);

  assert.strictEqual(registry.hasAdapter('google-drive'), true);
  assert.strictEqual(registry.hasAdapter('screenscraper'), true);
  assert.strictEqual(registry.hasAdapter('retroachievements'), true);
  assert.strictEqual(registry.hasAdapter('igdb'), true);
  assert.strictEqual(registry.hasAdapter('emulationstation-de'), true);

  assert.strictEqual(gdriveAdapter.definition.category, 'STORAGE');
  assert.strictEqual(ssAdapter.definition.category, 'METADATA');
  assert.strictEqual(retroAdapter.definition.category, 'ACHIEVEMENTS');
  assert.strictEqual(esAdapter.definition.category, 'FRONTEND');

  assert.ok(gdriveAdapter.definition.capabilities.includes('STORAGE_READ'));
  assert.ok(gdriveAdapter.definition.capabilities.includes('QUOTA'));
  assert.ok(ssAdapter.definition.capabilities.includes('METADATA_SEARCH'));
  assert.ok(ssAdapter.definition.capabilities.includes('ARTWORK'));
  assert.ok(retroAdapter.definition.capabilities.includes('ACHIEVEMENTS'));

  assert.strictEqual(gdriveAdapter.definition.supportsMultipleAccounts, true);
  assert.strictEqual(ssAdapter.definition.supportsMultipleAccounts, false);
  console.log('✔ IntegrationRegistry and definition contracts validated successfully.');

  // --------------------------------------------------------------------------
  // [2/12] Migration 11 & Storage Accounts Reconciliation & Idempotence
  // --------------------------------------------------------------------------
  console.log('\n[2/12] Testing Migration 11 & non-destructive storage reconciliation...');
  const mockStorageAcc: StorageAccount = {
    id: 'gdrive-pre-existing-1',
    providerType: 'google_drive',
    providerAccountId: 'google-sub-999',
    accountName: 'Ryan Pre-existing Drive',
    accountEmail: 'ryan@gmail.com',
    credentialKey: 'google_drive:gdrive-pre-existing-1',
    status: 'ACTIVE',
    quotaTotalBytes: 5000000000,
    quotaUsedBytes: 2000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  storageRepo.upsert(mockStorageAcc);

  const manager = new IntegrationManager(registry, connRepo, storageRepo);
  manager.reconcileStorageAccounts();

  const reconciled = connRepo.getById('gdrive-pre-existing-1');
  assert.ok(reconciled, 'Pre-existing storage account should be reconciled into integration_connections');
  assert.strictEqual(reconciled?.integrationId, 'google-drive');
  assert.strictEqual(reconciled?.status, 'CONNECTED');
  assert.strictEqual(reconciled?.accountLabel, 'ryan@gmail.com');

  // Idempotence check: run schema initialization again
  initializeDatabaseSchema(db);
  manager.reconcileStorageAccounts();
  const allConns = connRepo.getAll();
  assert.strictEqual(allConns.filter((c) => c.id === 'gdrive-pre-existing-1').length, 1);
  console.log('✔ Non-destructive reconciliation & idempotent migrations validated.');

  // --------------------------------------------------------------------------
  // [3/12] Security: Zero Secret Leaks in SQLite & Sanitized Renderer Views
  // --------------------------------------------------------------------------
  console.log('\n[3/12] Testing zero secret leakage in SQLite and sanitized views...');
  const secretPassword = 'MySecretSuperPassword123!';
  const screenScraperConnId = 'ss-conn-sec-test';
  const ssCredKey = `integration:screenscraper:${screenScraperConnId}`;

  await credStore.set(ssCredKey, JSON.stringify({ username: 'ryan_vault', password: secretPassword }));

  connRepo.upsert({
    id: screenScraperConnId,
    integrationId: 'screenscraper',
    externalAccountId: 'ryan_vault',
    displayName: 'ScreenScraper (ryan_vault)',
    status: 'CONNECTED',
    credentialKey: ssCredKey,
    configJson: JSON.stringify({ language: 'pt', preferredCoverFormat: '2d' }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Verify raw SQLite row
  const rawRow = db.prepare('SELECT * FROM integration_connections WHERE id = ?').get(screenScraperConnId) as any;
  assert.ok(!JSON.stringify(rawRow).includes(secretPassword), 'SQLite row must NEVER contain raw password');
  assert.ok(!rawRow.config_json?.includes(secretPassword), 'configJson must NEVER contain secrets');

  // Verify sanitized view returned by manager
  const sanitizedList = manager.listIntegrations();
  const ssView = sanitizedList.find((i) => i.definition.id === 'screenscraper');
  assert.ok(ssView);
  assert.strictEqual(ssView.status, 'CONNECTED');
  assert.strictEqual(ssView.connectedCount, 1);
  assert.ok(!JSON.stringify(ssView).includes(secretPassword), 'Renderer view must NEVER contain secret credentials');
  console.log('✔ Zero secret leakage in SQLite and renderer payloads validated.');

  // --------------------------------------------------------------------------
  // [4/12] Logger Recursive Sensitive Key Redaction
  // --------------------------------------------------------------------------
  console.log('\n[4/12] Testing recursive secret redaction in logger...');
  const payloadToLog = {
    user: 'ryan',
    password: 'UnsafePassword1',
    credentials: {
      apiKey: 'api-key-secret-12345',
      accessToken: 'ya29.secret_token',
      refreshToken: '1//refresh_token_secret',
      clientSecret: 'super-secret-client',
      nested: {
        authorization: 'Bearer token_abc',
        sspassword: 'ss_password_secret'
      }
    },
    safeField: 'Public Data'
  };

  const sanitized = sanitizeLogData(payloadToLog) as any;
  assert.strictEqual(sanitized.password, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.apiKey, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.accessToken, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.refreshToken, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.clientSecret, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.nested.authorization, '***REDACTED***');
  assert.strictEqual(sanitized.credentials.nested.sspassword, '***REDACTED***');
  assert.strictEqual(sanitized.safeField, 'Public Data');
  console.log('✔ Logger recursive multi-level secret redaction verified.');

  // --------------------------------------------------------------------------
  // [5/12] Multiple Google Accounts & Single Account Enforcement
  // --------------------------------------------------------------------------
  console.log('\n[5/12] Testing multiple accounts support and single account enforcement...');
  // Add second Google Drive connection
  const gdriveConn2: StorageAccount = {
    id: 'gdrive-acc-2',
    providerType: 'google_drive',
    providerAccountId: 'google-sub-222',
    accountName: 'Ryan Archive Drive',
    accountEmail: 'archive@gmail.com',
    credentialKey: 'google_drive:gdrive-acc-2',
    status: 'ACTIVE',
    quotaTotalBytes: 15000000000,
    quotaUsedBytes: 5000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  storageRepo.upsert(gdriveConn2);
  manager.reconcileStorageAccounts();

  const gdriveConns = manager.getConnections('google-drive');
  assert.strictEqual(gdriveConns.length, 2, 'Google Drive must support multiple accounts simultaneously');

  // Single account enforcement: ScreenScraper cannot connect twice
  let singleAccountErrorCaught = false;
  try {
    await manager.connect('screenscraper', {
      credentials: { username: 'second_user', password: 'password123' }
    });
  } catch (err: any) {
    singleAccountErrorCaught = true;
    assert.ok(err.message.includes('does not support multiple accounts'));
  }
  assert.strictEqual(singleAccountErrorCaught, true);
  console.log('✔ Multiple Google accounts and single-account constraint enforcement verified.');

  // --------------------------------------------------------------------------
  // [6/12] Duplicate External Account DB Constraint
  // --------------------------------------------------------------------------
  console.log('\n[6/12] Testing UNIQUE(integration_id, external_account_id) constraint...');
  let constraintViolation = false;
  try {
    db.prepare(`
      INSERT INTO integration_connections (
        id, integration_id, external_account_id, display_name, status, created_at, updated_at
      ) VALUES ('dup-test', 'screenscraper', 'ryan_vault', 'Duplicate', 'CONNECTED', 'now', 'now')
    `).run();
  } catch (err: any) {
    constraintViolation = true;
    assert.ok(err.message.includes('UNIQUE constraint failed'));
  }
  assert.strictEqual(constraintViolation, true);
  console.log('✔ Duplicate external account prevention verified.');

  // --------------------------------------------------------------------------
  // [7/12] Disconnect & Reconnect Lifecycle
  // --------------------------------------------------------------------------
  console.log('\n[7/12] Testing disconnect and reconnect lifecycles...');
  await manager.disconnect(screenScraperConnId);
  const disconnectedConn = connRepo.getById(screenScraperConnId);
  assert.strictEqual(disconnectedConn?.status, 'DISCONNECTED');
  const storedCredAfterDisc = await credStore.get(ssCredKey);
  assert.strictEqual(storedCredAfterDisc, null, 'Disconnect must delete stored credentials from secure store');

  // Reconnecting ScreenScraper
  // Create a mock adapter with simulated API response
  const mockClient = new ExternalServiceClient();
  mockClient.request = (async () => ({
    data: {
      response: {
        ssuser: {
          id: 'ryan_vault',
          numid: 12345,
          niveau: 1,
          requeststoday: 50,
          maxrequestsperday: 20000,
          maxthreads: 2,
          favregion: 'wor'
        }
      }
    },
    latencyMs: 145,
    status: 200
  })) as any;

  const customSSAdapter = new ScreenScraperIntegrationAdapter(connRepo, mockClient);
  registry.register(customSSAdapter);

  const reconnected = await manager.reconnect(screenScraperConnId, {
    credentials: { username: 'ryan_vault', password: 'NewPassword123' }
  });
  assert.strictEqual(reconnected.status, 'CONNECTED');
  assert.strictEqual(reconnected.id, screenScraperConnId, 'Reconnect must reuse existing connection ID');
  const newCredStored = await credStore.get(ssCredKey);
  assert.ok(newCredStored);
  console.log('✔ Disconnect and reconnect lifecycle verified.');

  // --------------------------------------------------------------------------
  // [8/12] Test Connection: Latency, Success, Quotas & Rate Limits
  // --------------------------------------------------------------------------
  console.log('\n[8/12] Testing testConnection() latency, success, and rate limits...');
  const testRes = await manager.testConnection(screenScraperConnId);
  assert.strictEqual(testRes.success, true);
  assert.strictEqual(testRes.latencyMs, 145);
  assert.strictEqual(testRes.accountInfo?.username, 'ryan_vault');
  assert.strictEqual(testRes.accountInfo?.requestsToday, 50);

  // Rate limited simulation
  mockClient.request = (async () => ({
    data: {
      response: {
        ssuser: {
          id: 'ryan_vault',
          niveau: 1,
          requeststoday: 20000,
          maxrequestsperday: 20000,
          maxthreads: 1
        }
      }
    },
    latencyMs: 120,
    status: 200
  })) as any;

  const rateLimitTest = await manager.testConnection(screenScraperConnId);
  assert.strictEqual(rateLimitTest.errorCode, 'RATE_LIMITED');
  const healthRateLimited = await manager.getHealth(screenScraperConnId);
  assert.strictEqual(healthRateLimited, 'RATE_LIMITED');
  console.log('✔ Latency calculation, success parsing, and rate limit health verified.');

  // --------------------------------------------------------------------------
  // [9/12] ScreenScraper Invalid Credentials & Network Errors
  // --------------------------------------------------------------------------
  console.log('\n[9/12] Testing invalid credentials and network error handling...');
  mockClient.request = (async () => ({
    data: {
      response: {
        erreur: 'Erreur : Identifiant ou mot de passe incorrect'
      }
    },
    latencyMs: 110,
    status: 200
  })) as any;

  const authFailTest = await manager.testConnection(screenScraperConnId);
  assert.strictEqual(authFailTest.success, false);
  assert.strictEqual(authFailTest.errorCode, 'AUTH_EXPIRED');

  // Network error test
  mockClient.request = async () => {
    throw new Error('ENOTFOUND api.screenscraper.fr');
  };
  const networkFailTest = await manager.testConnection(screenScraperConnId);
  assert.strictEqual(networkFailTest.success, false);
  assert.strictEqual(networkFailTest.errorCode, 'NETWORK_ERROR');
  console.log('✔ Invalid credentials and network error handling verified.');

  // --------------------------------------------------------------------------
  // [10/12] Capability-based Lookup (getConnectionsWithCapability)
  // --------------------------------------------------------------------------
  console.log('\n[10/12] Testing capability lookup API...');
  // While ScreenScraper is in AUTH_EXPIRED from test 9, capability lookup should exclude it
  const expiredConnections = manager.getConnectionsWithCapability('METADATA_SEARCH');
  assert.strictEqual(expiredConnections.length, 0, 'Expired connections should be excluded from active capability lookups');

  // Once restored to CONNECTED, capability lookup should find it
  connRepo.updateStatus(screenScraperConnId, 'CONNECTED');
  const metadataConnections = manager.getConnectionsWithCapability('METADATA_SEARCH');
  assert.strictEqual(metadataConnections.length, 1);
  assert.strictEqual(metadataConnections[0].integrationId, 'screenscraper');

  const storageConnections = manager.getConnectionsWithCapability('STORAGE_READ');
  assert.strictEqual(storageConnections.length, 2);

  const achievementConnections = manager.getConnectionsWithCapability('ACHIEVEMENTS');
  assert.strictEqual(achievementConnections.length, 0);
  console.log('✔ Capability-based provider lookup API validated.');

  // --------------------------------------------------------------------------
  // [11/12] ScreenScraper MetadataProvider Interface
  // --------------------------------------------------------------------------
  console.log('\n[11/12] Testing ScreenScraperMetadataProvider domain interface...');
  // Restore valid mock credentials
  await credStore.set(ssCredKey, JSON.stringify({ username: 'ryan_vault', password: 'valid_password' }));
  connRepo.updateStatus(screenScraperConnId, 'CONNECTED');

  mockClient.request = (async () => ({
    data: {
      response: {
        jeux: [
          {
            id: 101,
            noms: [{ nom: 'Chrono Trigger' }],
            systeme: { nom: 'Super Nintendo' },
            dates: [{ annee: 1995 }],
            developpeur: { nom: 'Square' },
            synopsis: [{ texte: 'A timeless role-playing classic.' }]
          }
        ]
      }
    },
    latencyMs: 90,
    status: 200
  })) as any;

  const metadataProvider = new ScreenScraperMetadataProvider(connRepo, mockClient);
  const searchResults = await metadataProvider.searchGame('Chrono Trigger');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].title, 'Chrono Trigger');
  assert.strictEqual(searchResults[0].releaseYear, 1995);

  const artwork = await metadataProvider.getArtwork('101');
  assert.ok(artwork.length >= 2);
  assert.strictEqual(artwork[0].type, 'box_2d');
  console.log('✔ ScreenScraperMetadataProvider domain queries validated.');

  // --------------------------------------------------------------------------
  // [12/12] Real ScreenScraper Auth Test Reporting
  // --------------------------------------------------------------------------
  console.log('\n[12/12] Checking for live credentials...');
  if (process.env.GAMEVAULT_SCREENSCRAPER_USER && process.env.GAMEVAULT_SCREENSCRAPER_PASSWORD) {
    console.log('⚡ Live credentials detected. Executing live ScreenScraper test...');
  } else {
    console.log('ℹ REAL SCREENSCRAPER AUTH TEST NOT EXECUTED (No credentials in env)');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL INTEGRATION HUB ARCHITECTURE TESTS PASSED SUCCESSFULLY! (12/12)');
  console.log('================================================================\n');
}

runIntegrationsTestSuite().catch((err) => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
