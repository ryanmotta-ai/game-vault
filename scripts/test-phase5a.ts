import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';

import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameFilesRepository } from '../src/database/repositories/gameFilesRepository';
import { GameMetadataRepository } from '../src/database/repositories/gameMetadataRepository';
import { GameMetadataSourcesRepository } from '../src/database/repositories/gameMetadataSourcesRepository';
import { GameArtworkRepository } from '../src/database/repositories/gameArtworkRepository';
import { MetadataJobsRepository } from '../src/database/repositories/metadataJobsRepository';
import { IntegrationConnectionsRepository } from '../src/database/repositories/integrationConnectionsRepository';
import { IntegrationRegistry } from '../src/integrations/IntegrationRegistry';
import { IntegrationManager } from '../src/integrations/IntegrationManager';

import { MetadataPlatformMapper } from '../src/metadata/MetadataPlatformMapper';
import { GameIdentificationService } from '../src/metadata/GameIdentificationService';
import { MetadataCandidateScorer } from '../src/metadata/MetadataCandidateScorer';
import { MetadataMatchResolver } from '../src/metadata/MetadataMatchResolver';
import { MetadataRequestCache } from '../src/metadata/MetadataRequestCache';
import { MetadataProviderRegistry } from '../src/metadata/MetadataProviderRegistry';
import { MetadataMergeService } from '../src/metadata/MetadataMergeService';
import { ArtworkCacheManager } from '../src/metadata/ArtworkCacheManager';
import { MetadataJobManager } from '../src/metadata/MetadataJobManager';
import { MetadataProvider } from '../src/integrations/metadata/MetadataProvider';

import { Game, GameFile, GameIdentityQuery, MetadataCandidate } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

const TEST_DIR = path.resolve(__dirname, '../.test_phase5a_tmp');
let testServer: http.Server | null = null;
let serverPort = 0;

function cleanDir(dir: string) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function startMockServer(): Promise<number> {
  return new Promise((resolve) => {
    testServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${serverPort}`);

      if (url.pathname === '/image.png') {
        // Valid 1x1 transparent PNG
        const png1x1 = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64'
        );
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(png1x1.length) });
        res.end(png1x1);
      } else if (url.pathname === '/not-an-image.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Not an image</body></html>');
      } else if (url.pathname === '/huge-image.jpg') {
        // Exceeds 25MB limit
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(30 * 1024 * 1024) });
        res.write(Buffer.alloc(1024 * 1024)); // Write 1MB chunk
        setTimeout(() => {
          res.end(Buffer.alloc(1024));
        }, 50);
      } else if (url.pathname === '/rate-limited') {
        res.writeHead(429, { 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'Too many requests' }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    testServer.listen(0, '127.0.0.1', () => {
      const addr = testServer!.address() as any;
      serverPort = addr.port;
      resolve(serverPort);
    });
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🎮 GAME VAULT - PHASE 5A METADATA & ARTWORK PIPELINE TEST SUITE');
  console.log('================================================================\n');

  cleanDir(TEST_DIR);
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const port = await startMockServer();
  console.log(`✓ Mock HTTP test server started on port ${port}\n`);

  const dbPath = path.join(TEST_DIR, 'test_metadata.sqlite');
  const db = new Database(dbPath);
  initializeDatabaseSchema(db);

  const gamesRepo = new GamesRepository(db);
  const gameFilesRepo = new GameFilesRepository(db);
  const metadataRepo = new GameMetadataRepository(db);
  const sourcesRepo = new GameMetadataSourcesRepository(db);
  const artworkRepo = new GameArtworkRepository(db);
  const jobsRepo = new MetadataJobsRepository(db);
  const connectionsRepo = new IntegrationConnectionsRepository(db);

  const artworkDir = path.join(TEST_DIR, 'artwork_cache');
  fs.mkdirSync(artworkDir, { recursive: true });

  const artworkCache = new ArtworkCacheManager({
    artworkBaseDir: artworkDir,
    artworkRepo,
    allowLocalhost: true
  });

  let passed = 0;
  const total = 60;

  function report(num: number, desc: string) {
    passed++;
    console.log(`[PASS ${String(num).padStart(2, '0')}/${total}] ${desc}`);
  }

  // ==========================================================================
  // SECTION 1: DATABASE SCHEMA & MIGRATION 013 (Tests 1-6)
  // ==========================================================================
  {
    const metaTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_metadata'").get();
    assert(metaTable !== undefined, 'game_metadata table should exist');
    report(1, 'Database Schema: Migration 013 creates game_metadata table');
  }

  {
    const sourcesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_metadata_sources'").get();
    assert(sourcesTable !== undefined, 'game_metadata_sources table should exist');
    report(2, 'Database Schema: Migration 013 creates game_metadata_sources table');
  }

  {
    const artworkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_artwork'").get();
    assert(artworkTable !== undefined, 'game_artwork table should exist');
    report(3, 'Database Schema: Migration 013 creates game_artwork table');
  }

  {
    const jobsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata_jobs'").get();
    assert(jobsTable !== undefined, 'metadata_jobs table should exist');
    report(4, 'Database Schema: Migration 013 creates metadata_jobs table');
  }

  {
    // Need a dummy game for foreign key
    db.prepare(`
      INSERT OR IGNORE INTO games (id, title, slug, platform, state, size_bytes, play_time_seconds, created_at, updated_at)
      VALUES ('g_dup', 'Dup Test', 'dup-test', 'PC', 'CLOUD', 100, 0, 'now', 'now')
    `).run();

    let duplicateRejected = false;
    try {
      db.prepare(`
        INSERT INTO game_metadata_sources (id, game_id, provider_id, provider_game_id, confidence, matched_at, status, created_at, updated_at)
        VALUES ('dup1', 'g_dup', 'p_dup', '1', 'EXACT', 'now', 'MATCHED', 'now', 'now')
      `).run();
      db.prepare(`
        INSERT INTO game_metadata_sources (id, game_id, provider_id, provider_game_id, confidence, matched_at, status, created_at, updated_at)
        VALUES ('dup2', 'g_dup', 'p_dup', '2', 'EXACT', 'now', 'MATCHED', 'now', 'now')
      `).run();
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'Unique constraint on (game_id, provider_id) should reject duplicates');
    report(5, 'Database Schema: Unique compound constraint on game_metadata_sources (game_id, provider_id) is enforced');
  }

  {
    const defaultPref = db.prepare("SELECT value FROM settings WHERE key='metadata_preferred_provider'").get() as any;
    assert(defaultPref && (defaultPref.value === 'auto' || defaultPref.value === 'screenscraper'), 'Default preferred provider should be seeded');
    report(6, 'Database Schema: Migration 013 seeds default metadata preferences into settings');
  }

  // ==========================================================================
  // SECTION 2: REPOSITORIES CRUD & CONSTRAINTS (Tests 7-14)
  // ==========================================================================
  const testGameId = 'game_mgs3';
  gamesRepo.upsert({
    id: testGameId,
    title: 'Metal Gear Solid 3: Snake Eater',
    slug: 'metal-gear-solid-3',
    platform: 'PlayStation 2',
    state: 'READY',
    sizeBytes: 4000000000,
    playTimeSeconds: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  {
    metadataRepo.upsert({
      gameId: testGameId,
      canonicalTitle: 'Metal Gear Solid 3: Snake Eater',
      releaseYear: 2004,
      developer: 'Konami Computer Entertainment Japan',
      publisher: 'Konami',
      genresJson: JSON.stringify(['Stealth', 'Action-Adventure']),
      rating: 9.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const readBack = metadataRepo.getByGameId(testGameId);
    assert(readBack !== null && readBack.canonicalTitle === 'Metal Gear Solid 3: Snake Eater', 'Read canonical title');
    assert(readBack.releaseYear === 2004, 'Read release year');
    report(7, 'GameMetadataRepository: Upsert and retrieve enriched metadata record');
  }

  {
    metadataRepo.addOverrideFlag(testGameId, 'title');
    metadataRepo.addOverrideFlag(testGameId, 'description');
    const flags = metadataRepo.getOverriddenFields(testGameId);
    assert(flags.includes('title') && flags.includes('description'), 'Override flags tracked');
    report(8, 'GameMetadataRepository: User override flags tracking and JSON serialization');
  }

  {
    sourcesRepo.upsert({
      id: 'src_1',
      gameId: testGameId,
      providerId: 'screenscraper',
      providerGameId: '12345',
      confidence: 'EXACT',
      matchedAt: new Date().toISOString(),
      status: 'MATCHED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const src = sourcesRepo.getByGameAndProvider(testGameId, 'screenscraper');
    assert(src !== null && src.providerGameId === '12345', 'Retrieved source record');
    report(9, 'GameMetadataSourcesRepository: Track source provenance and provider mapping');
  }

  {
    sourcesRepo.upsert({
      id: 'src_rev_1',
      gameId: testGameId,
      providerId: 'igdb',
      providerGameId: '99999',
      confidence: 'AMBIGUOUS',
      matchedAt: new Date().toISOString(),
      status: 'REVIEW_REQUIRED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const queue = sourcesRepo.getReviewQueue();
    assert(queue.some((q) => q.id === 'src_rev_1'), 'Source in review queue');
    report(10, 'GameMetadataSourcesRepository: Query review queue with REVIEW_REQUIRED status');
  }

  {
    sourcesRepo.updateStatusById('src_rev_1', 'USER_CONFIRMED');
    const updated = sourcesRepo.getById('src_rev_1');
    assert(updated !== null && updated.status === 'USER_CONFIRMED', 'Status updated to USER_CONFIRMED');
    report(11, 'GameMetadataSourcesRepository: Resolve review queue status via updateStatusById');
  }

  {
    artworkRepo.upsert({
      id: 'art_1',
      gameId: testGameId,
      type: 'COVER_FRONT',
      provider: 'screenscraper',
      localPath: path.join(artworkDir, 'cover1.jpg'),
      isPrimary: true,
      status: 'CACHED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const primary1 = artworkRepo.getPrimaryArtwork(testGameId, 'COVER_FRONT');
    assert(primary1 !== null && primary1.id === 'art_1', 'art_1 should be primary cover');

    // Insert new primary artwork - art_1 should automatically lose primary flag
    artworkRepo.upsert({
      id: 'art_2',
      gameId: testGameId,
      type: 'COVER_FRONT',
      provider: 'user_custom',
      localPath: path.join(artworkDir, 'cover2.png'),
      isPrimary: true,
      isUserCustom: true,
      status: 'CACHED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const primary2 = artworkRepo.getPrimaryArtwork(testGameId, 'COVER_FRONT');
    assert(primary2 !== null && primary2.id === 'art_2', 'art_2 should now be primary cover');
    const oldPrimary = artworkRepo.getById('art_1');
    assert(oldPrimary !== null && !oldPrimary.isPrimary, 'art_1 must no longer be primary');
    report(12, 'GameArtworkRepository: Automatic primary artwork flag switching on conflict');
  }

  {
    jobsRepo.upsert({
      id: 'job_norm',
      gameId: testGameId,
      status: 'QUEUED',
      priority: 'NORMAL',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    jobsRepo.upsert({
      id: 'job_user',
      gameId: testGameId,
      status: 'QUEUED',
      priority: 'USER_REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const next = jobsRepo.getNextQueuedJob();
    assert(next !== null && next.priority === 'USER_REQUESTED', 'USER_REQUESTED must be picked before NORMAL');
    report(13, 'MetadataJobsRepository: Priority queue ordering (USER_REQUESTED > NORMAL > BACKGROUND)');
  }

  {
    jobsRepo.updateStatus('job_user', 'SEARCHING');
    const staleCount = jobsRepo.recoverStaleJobs();
    assert(staleCount >= 1, 'Stale job was recovered');
    const recovered = jobsRepo.getById('job_user');
    assert(recovered !== null && recovered.status === 'QUEUED', 'Stale job reset to QUEUED');
    report(14, 'MetadataJobsRepository: Crash recovery resets interrupted jobs back to QUEUED');
  }

  // ==========================================================================
  // SECTION 3: PLATFORM MAPPING (Tests 15-20)
  // ==========================================================================
  {
    assert(MetadataPlatformMapper.toScreenScraperSystemId('SNES') === 4, 'SNES -> ScreenScraper 4');
    assert(MetadataPlatformMapper.toScreenScraperSystemId('PlayStation') === 57, 'PlayStation -> ScreenScraper 57');
    assert(MetadataPlatformMapper.toScreenScraperSystemId('PlayStation 2') === 58, 'PlayStation 2 -> ScreenScraper 58');
    report(15, 'MetadataPlatformMapper: Exact platform to ScreenScraper numeric system ID mapping');
  }

  {
    assert(MetadataPlatformMapper.toGamePlatform('snes') === 'SNES', 'snes alias');
    assert(MetadataPlatformMapper.toGamePlatform('super famicom') === 'SNES', 'super famicom alias');
    report(16, 'MetadataPlatformMapper: Map informal platform aliases to canonical GamePlatform');
  }

  {
    assert(MetadataPlatformMapper.toGamePlatform('ps2') === 'PlayStation 2', 'ps2 alias');
    assert(MetadataPlatformMapper.toGamePlatform('sony playstation 2') === 'PlayStation 2', 'sony ps2 alias');
    report(17, 'MetadataPlatformMapper: Map PlayStation 2 variants to canonical GamePlatform');
  }

  {
    assert(MetadataPlatformMapper.toGamePlatform('genesis') === 'Retro', 'genesis maps to Retro');
    assert(MetadataPlatformMapper.toGamePlatform('mega drive') === 'Retro', 'mega drive maps to Retro');
    report(18, 'MetadataPlatformMapper: Map 16-bit Sega consoles to Retro platform');
  }

  {
    assert(MetadataPlatformMapper.fromScreenScraperSystemId(58) === 'PlayStation 2', 'Reverse SS ID 58 -> PS2');
    assert(MetadataPlatformMapper.fromScreenScraperSystemId(4) === 'SNES', 'Reverse SS ID 4 -> SNES');
    report(19, 'MetadataPlatformMapper: Reverse ScreenScraper ID lookup to canonical GamePlatform');
  }

  {
    assert(MetadataPlatformMapper.isPlatformSupported('PlayStation 2') === true, 'PS2 supported');
    assert(MetadataPlatformMapper.isPlatformSupported('UnknownPlatformXYZ') === false, 'Unknown unsupported');
    report(20, 'MetadataPlatformMapper: Platform support validation and unknown platform handling');
  }

  // ==========================================================================
  // SECTION 4: IDENTIFICATION & ROM TAG EXTRACTION (Tests 21-26)
  // ==========================================================================
  {
    const raw = 'Super Mario World (USA) (Rev 1).sfc';
    const query = GameIdentificationService.identify(
      { id: 'g_smw', title: raw, platform: 'SNES' } as Game,
      { filename: raw } as GameFile
    );
    assert(query.cleanTitle === 'Super Mario World', `Clean title matches, got: ${query.cleanTitle}`);
    assert(query.region === 'NA', 'USA tag normalized to NA region');
    report(21, 'GameIdentificationService: Extract clean title and normalize USA region tag');
  }

  {
    const raw = 'Gran Turismo (Europe) (En,Fr,De).iso';
    const query = GameIdentificationService.identify(
      { id: 'g_gt', title: raw, platform: 'PlayStation' } as Game,
      { filename: raw } as GameFile
    );
    assert(query.region === 'EU', 'Europe tag normalized to EU');
    report(22, 'GameIdentificationService: Normalize European multi-language tags to EU region');
  }

  {
    const raw = 'Final Fantasy VII (USA) (Disc 2).bin';
    const discNum = GameIdentificationService.extractDiscNumber(raw);
    assert(discNum === 2, `Disc number should be 2, got ${discNum}`);
    report(23, 'GameIdentificationService: Multi-disc sequence detection and discNumber extraction');
  }

  {
    const raw = 'Metal Gear Solid [SLUS-00594] (Disc 1).iso';
    const serial = GameIdentificationService.extractSerial(raw);
    assert(serial === 'SLUS-00594', `Serial extraction should match SLUS-00594, got ${serial}`);
    report(24, 'GameIdentificationService: Game serial code extraction from brackets');
  }

  {
    const raw = 'Castlevania - Symphony of the Night [SCUS-94163].chd';
    const serial = GameIdentificationService.extractSerial(raw);
    assert(serial === 'SCUS-94163', `Serial code SCUS-94163, got ${serial}`);
    report(25, 'GameIdentificationService: PlayStation SCUS serial identification');
  }

  {
    const game = { id: 'g_test', title: 'Chrono Trigger (USA) [!]', platform: 'SNES' } as Game;
    const file = { filename: 'Chrono Trigger (USA) [!].smc', md5Checksum: 'a1b2c3d4e5' } as GameFile;
    const query = GameIdentificationService.identify(game, file);
    assert(query.cleanTitle === 'Chrono Trigger', 'Clean title matches');
    assert(query.md5 === 'a1b2c3d4e5', 'MD5 preserved in query');
    assert(query.normalizedPlatform === 'SNES', 'Platform normalized');
    report(26, 'GameIdentificationService: Complete GameIdentityQuery struct assembly');
  }

  // ==========================================================================
  // SECTION 5: CANDIDATE SCORING ENGINE (Tests 27-33)
  // ==========================================================================
  {
    const identity: GameIdentityQuery = {
      gameId: 'g1',
      title: 'Chrono Trigger',
      cleanTitle: 'Chrono Trigger',
      platform: 'SNES',
      normalizedPlatform: 'SNES'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '100',
      title: 'Chrono Trigger',
      platform: 'SNES'
    });

    assert(candidate.totalScore >= 95, `Exact title & platform should score >= 95, got ${candidate.totalScore}`);
    assert(candidate.confidence === 'EXACT', 'Confidence should be EXACT');
    report(27, 'MetadataCandidateScorer: Exact title and platform match scores >= 95 with EXACT confidence');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g2',
      title: 'Metal Gear Solid',
      cleanTitle: 'Metal Gear Solid',
      platform: 'PlayStation',
      normalizedPlatform: 'PlayStation',
      serial: 'SLUS-00594'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '200',
      title: 'Metal Gear Solid: Integral',
      platform: 'PlayStation'
    });

    assert(candidate.matchSignals.platformMatch === true, 'Platform match should be true');
    assert(candidate.totalScore >= 75, 'Good title similarity with platform bonus');
    report(28, 'MetadataCandidateScorer: Platform match adds bonus and boosts confidence');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g3',
      title: 'Sonic The Hedgehog 2',
      cleanTitle: 'Sonic The Hedgehog 2',
      platform: 'Retro',
      normalizedPlatform: 'Retro'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '300',
      title: 'Sonic The Hedgehog 2',
      platform: 'Game Gear' // Platform mismatch
    });

    assert(candidate.matchSignals.platformMatch === false, 'Platform match should be false');
    assert(candidate.totalScore < 60, `Platform mismatch penalty applied, got ${candidate.totalScore}`);
    report(29, 'MetadataCandidateScorer: Cross-platform mismatch penalty prevents false matches');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g4',
      title: 'Final Fantasy VI',
      cleanTitle: 'Final Fantasy VI',
      platform: 'SNES',
      normalizedPlatform: 'SNES',
      region: 'NA',
      releaseYearHint: 1994
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '400',
      title: 'Final Fantasy VI',
      platform: 'SNES',
      region: 'NA',
      releaseYear: 1994
    });

    assert(candidate.matchSignals.regionMatch === true, 'Region match');
    assert(candidate.matchSignals.yearMatch === true, 'Year match');
    assert(candidate.totalScore === 100, 'All signals match');
    report(30, 'MetadataCandidateScorer: Region and Release Year matching bonus signals');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g5',
      title: 'Gran Turismo 4',
      cleanTitle: 'Gran Turismo 4',
      platform: 'PlayStation 2',
      normalizedPlatform: 'PlayStation 2',
      serial: 'SCUS-97328'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '500',
      title: 'Gran Turismo 4',
      platform: 'PlayStation 2',
      serial: 'SCUS-97328'
    });

    assert(candidate.matchSignals.serialMatch === true, 'Serial matches exactly');
    assert(candidate.totalScore >= 95, 'Exact serial match achieves >= 95 score');
    report(31, 'MetadataCandidateScorer: Hardware serial match signal guarantees high score');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g6',
      title: 'Super Mario World',
      cleanTitle: 'Super Mario World',
      platform: 'SNES',
      normalizedPlatform: 'SNES',
      md5: 'abcdef1234567890'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '600',
      title: 'Super Mario World',
      platform: 'SNES',
      hash: 'abcdef1234567890'
    });

    assert(candidate.matchSignals.hashMatch === true, 'Hash match is true');
    assert(candidate.totalScore === 100, 'Exact ROM hash match yields 100 score');
    report(32, 'MetadataCandidateScorer: Exact binary hash match yields perfect 100 score');
  }

  {
    const identity: GameIdentityQuery = {
      gameId: 'g7',
      title: 'Unrelated Unknown Title',
      cleanTitle: 'Unrelated Unknown Title',
      platform: 'SNES',
      normalizedPlatform: 'SNES'
    };

    const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
      provider: 'screenscraper',
      providerGameId: '700',
      title: 'Totally Different Game',
      platform: 'NES'
    });

    assert(candidate.totalScore < 30, `Score bounded appropriately, got ${candidate.totalScore}`);
    assert(candidate.confidence === 'LOW', 'Confidence is LOW');
    report(33, 'MetadataCandidateScorer: Dissimilar candidate scored LOW without false positives');
  }

  // ==========================================================================
  // SECTION 6: MATCH RESOLUTION & REVIEW QUEUE (Tests 34-38)
  // ==========================================================================
  {
    const candidates: MetadataCandidate[] = [
      {
        provider: 'screenscraper',
        providerGameId: '1',
        title: 'Castlevania',
        totalScore: 96,
        confidence: 'EXACT',
        matchSignals: { titleScore: 100, platformMatch: true }
      }
    ];

    const res = MetadataMatchResolver.resolve(candidates);
    assert(res.requiresReview === false, 'Exact match should not require review');
    assert(res.confidence === 'EXACT', 'Confidence is EXACT');
    report(34, 'MetadataMatchResolver: Auto-accepts single high confidence EXACT match');
  }

  {
    // Ambiguous competitor scenario: Sonic 2 on Genesis (score 88) vs Sonic 2 on Game Gear (score 85)
    const candidates: MetadataCandidate[] = [
      {
        provider: 'screenscraper',
        providerGameId: 's1',
        title: 'Sonic The Hedgehog 2',
        platform: 'Genesis',
        totalScore: 88,
        confidence: 'HIGH',
        matchSignals: { titleScore: 100, platformMatch: true }
      },
      {
        provider: 'screenscraper',
        providerGameId: 's2',
        title: 'Sonic The Hedgehog 2',
        platform: 'Game Gear',
        totalScore: 85,
        confidence: 'HIGH',
        matchSignals: { titleScore: 100, platformMatch: true }
      }
    ];

    const res = MetadataMatchResolver.resolve(candidates);
    assert(res.requiresReview === true, 'Close scores delta < 5 must require review');
    assert(res.confidence === 'AMBIGUOUS', `Confidence should be AMBIGUOUS, got ${res.confidence}`);
    report(35, 'MetadataMatchResolver: Competitor delta < 5 triggers AMBIGUOUS review queue routing');
  }

  {
    const candidates: MetadataCandidate[] = [
      {
        provider: 'screenscraper',
        providerGameId: 'm1',
        title: 'Super Metroid',
        totalScore: 88,
        confidence: 'HIGH',
        matchSignals: { titleScore: 90, platformMatch: true }
      },
      {
        provider: 'screenscraper',
        providerGameId: 'm2',
        title: 'Metroid Fusion',
        totalScore: 60,
        confidence: 'MEDIUM',
        matchSignals: { titleScore: 60, platformMatch: true }
      }
    ];

    const res = MetadataMatchResolver.resolve(candidates);
    assert(res.requiresReview === false, 'Large margin (28 points) allows auto-application');
    assert(res.bestMatch?.providerGameId === 'm1', 'Picks top runner');
    report(36, 'MetadataMatchResolver: Clear margin (>= 10 points) permits confident automatic resolution');
  }

  {
    const candidates: MetadataCandidate[] = [
      {
        provider: 'screenscraper',
        providerGameId: 'low1',
        title: 'Questionable Match',
        totalScore: 50,
        confidence: 'LOW',
        matchSignals: { titleScore: 50, platformMatch: false }
      }
    ];

    const res = MetadataMatchResolver.resolve(candidates);
    assert(res.requiresReview === true, 'LOW confidence candidate requires user review');
    report(37, 'MetadataMatchResolver: Single candidate with LOW confidence requires user confirmation');
  }

  {
    const res = MetadataMatchResolver.resolve([]);
    assert(res.bestMatch === null, 'No best match');
    assert(res.requiresReview === false, 'Empty candidate list does not trigger review');
    report(38, 'MetadataMatchResolver: Handles empty candidate list gracefully');
  }

  // ==========================================================================
  // SECTION 7: REQUEST CACHE & NEGATIVE CACHING (Tests 39-42)
  // ==========================================================================
  const reqCache = new MetadataRequestCache();

  {
    const key = reqCache.generateKey('screenscraper', 'search', { title: 'Zelda', platform: 'SNES' });
    reqCache.set(key, [{ title: 'The Legend of Zelda: A Link to the Past' }]);
    const cached = reqCache.get<any[]>(key);
    assert(cached !== null && cached.length === 1, 'Cache returned result');
    report(39, 'MetadataRequestCache: In-memory query caching and deterministic key generation');
  }

  {
    const emptyKey = reqCache.generateKey('screenscraper', 'search', 'nonexistent_rom_xyz');
    reqCache.setNegative(emptyKey);
    assert(reqCache.isNegative(emptyKey) === true, 'Key is in negative cache');
    assert(reqCache.get(emptyKey) === null, 'Negative cache returns null data');
    report(40, 'MetadataRequestCache: Negative cache tracks failed lookups to prevent API hammering');
  }

  {
    const expiringKey = 'test:expiring';
    reqCache.set(expiringKey, { value: 123 }, -1); // Already expired
    assert(reqCache.get(expiringKey) === null, 'Expired key returns null');
    report(41, 'MetadataRequestCache: TTL expiration invalidates stale entries');
  }

  {
    const stats = reqCache.getStats();
    assert(stats.hits > 0, 'Cache hits tracked');
    assert(stats.negativeEntries >= 1, 'Negative entries counted');
    report(42, 'MetadataRequestCache: Cache statistics report hits, misses, and negative entries');
  }

  // ==========================================================================
  // SECTION 8: PROVIDER REGISTRY & DECOUPLED DISCOVERY (Tests 43-47)
  // ==========================================================================
  const providerRegistry = new MetadataProviderRegistry();

  const mockProvider: MetadataProvider = {
    id: 'mock_provider',
    name: 'Mock Provider',
    searchGame: async (query: string) => [
      { id: 'mock_1', title: query, coverUrl: `http://127.0.0.1:${serverPort}/image.png` }
    ],
    identifyGame: async (identity: any) => ({
      id: 'mock_ident',
      title: identity.title || 'Mock Identified',
      coverUrl: `http://127.0.0.1:${serverPort}/image.png`
    }),
    getGameDetails: async (id: string) => ({
      id,
      title: 'Mock Details',
      description: 'Mock synopsis description'
    }),
    getArtwork: async (_id: string) => [
      { type: 'box_2d', url: `http://127.0.0.1:${serverPort}/image.png` }
    ],
    getMedia: async () => []
  };

  {
    providerRegistry.registerProvider(mockProvider);
    assert(providerRegistry.getProvider('mock_provider') !== undefined, 'Provider registered');
    report(43, 'MetadataProviderRegistry: Register and retrieve decoupled MetadataProvider');
  }

  {
    const preferred = providerRegistry.getPreferredProvider('mock_provider');
    assert(preferred !== null && preferred.id === 'mock_provider', 'Mock provider resolved as preferred');
    report(44, 'MetadataProviderRegistry: Select preferred provider with fallback');
  }

  {
    const candidates = await providerRegistry.searchCandidates({
      gameId: 'g_reg_test',
      title: 'Chrono Trigger',
      cleanTitle: 'Chrono Trigger',
      platform: 'SNES',
      normalizedPlatform: 'SNES'
    });
    assert(candidates.length > 0, 'Candidates returned across registry providers');
    report(45, 'MetadataProviderRegistry: Multi-provider candidate search and automatic scoring');
  }

  {
    providerRegistry.unregisterProvider('mock_provider');
    assert(providerRegistry.getProvider('mock_provider') === undefined, 'Provider unregistered');
    providerRegistry.registerProvider(mockProvider); // Re-register for subsequent tests
    report(46, 'MetadataProviderRegistry: Unregister provider dynamically');
  }

  {
    const integrationRegistry = new IntegrationRegistry();
    const integrationManager = new IntegrationManager(integrationRegistry, connectionsRepo);
    providerRegistry.setIntegrationManager(integrationManager);
    const available = providerRegistry.getAvailableProviders();
    assert(Array.isArray(available), 'Available providers list returned');
    report(47, 'MetadataProviderRegistry: Dynamic discovery via IntegrationManager capability checks');
  }

  // ==========================================================================
  // SECTION 9: METADATA MERGE SERVICE & USER OVERRIDES (Tests 48-52)
  // ==========================================================================
  const mergeService = new MetadataMergeService(metadataRepo, sourcesRepo, gamesRepo);

  const overrideGameId = 'game_merge_test';
  gamesRepo.upsert({
    id: overrideGameId,
    title: 'Custom User Title',
    slug: 'custom-user-title',
    platform: 'PlayStation 2',
    description: 'Custom User Description',
    state: 'READY',
    sizeBytes: 1000,
    playTimeSeconds: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  {
    // Apply candidate with remote data
    const candidate: MetadataCandidate = {
      provider: 'screenscraper',
      providerGameId: '1001',
      title: 'Remote Official Title',
      description: 'Remote Official Description',
      releaseYear: 2005,
      developer: 'Remote Dev',
      publisher: 'Remote Pub',
      genres: ['Action', 'RPG'],
      totalScore: 95,
      confidence: 'EXACT',
      matchSignals: { titleScore: 95, platformMatch: true }
    };

    const result = mergeService.applyCandidate(overrideGameId, candidate);
    assert(result.metadata.canonicalTitle === 'Remote Official Title', 'Canonical title applied');
    assert(result.source.providerGameId === '1001', 'Source provenance recorded');
    report(48, 'MetadataMergeService: Apply candidate metadata and mirror to games table');
  }

  {
    // Set user override for title
    mergeService.setUserOverride(overrideGameId, 'title', 'My Inviolable Custom Title');
    const meta = metadataRepo.getByGameId(overrideGameId);
    assert(meta !== null && meta.canonicalTitle === 'My Inviolable Custom Title', 'Title overridden');
    assert(metadataRepo.getOverriddenFields(overrideGameId).includes('title'), 'Override flag recorded');
    report(49, 'MetadataMergeService: Set manual user override flag for title');
  }

  {
    // Attempt remote update on overridden field
    const remoteUpdateCandidate: MetadataCandidate = {
      provider: 'screenscraper',
      providerGameId: '1001',
      title: 'Overwrite Attempt Title',
      description: 'Fresh Remote Description',
      totalScore: 98,
      confidence: 'EXACT',
      matchSignals: { titleScore: 98, platformMatch: true }
    };

    const merged = mergeService.applyCandidate(overrideGameId, remoteUpdateCandidate);
    assert(
      merged.metadata.canonicalTitle === 'My Inviolable Custom Title',
      `User override must be preserved! Got: ${merged.metadata.canonicalTitle}`
    );
    assert(merged.metadata.description === 'Fresh Remote Description', 'Non-overridden field was updated');
    report(50, 'MetadataMergeService: Strict protection - remote updates NEVER overwrite user-overridden fields');
  }

  {
    // Remove user override
    mergeService.removeUserOverride(overrideGameId, 'title');
    assert(!metadataRepo.getOverriddenFields(overrideGameId).includes('title'), 'Override flag removed');
    report(51, 'MetadataMergeService: Remove user override flag to restore remote sync');
  }

  {
    const readMeta = mergeService.getMetadata(overrideGameId);
    assert(readMeta !== null && readMeta.gameId === overrideGameId, 'Merged metadata readable');
    report(52, 'MetadataMergeService: Structured metadata view with parsed genres and overrides');
  }

  // ==========================================================================
  // SECTION 10: ARTWORK CACHE MANAGER & SSRF PROTECTION (Tests 53-57)
  // ==========================================================================
  {
    // SSRF validation
    const strictCache = new ArtworkCacheManager({ artworkBaseDir: artworkDir, allowLocalhost: false });
    assert(strictCache.isSafeRemoteUrl('http://127.0.0.1/test.png') === false, 'Loopback rejected');
    assert(strictCache.isSafeRemoteUrl('http://192.168.1.1/test.png') === false, 'Private 192.168 rejected');
    assert(strictCache.isSafeRemoteUrl('http://10.0.0.5/test.png') === false, 'Private 10.0.0.0 rejected');
    assert(strictCache.isSafeRemoteUrl('https://media.screenscraper.fr/test.png') === true, 'Public domain allowed');
    report(53, 'ArtworkCacheManager: SSRF protection blocks private IPv4 and loopback destinations');
  }

  {
    // Non-image MIME rejected
    const nonImageUrl = `http://127.0.0.1:${serverPort}/not-an-image.html`;
    const cached = await artworkCache.downloadAndCache({
      gameId: testGameId,
      remoteUrl: nonImageUrl,
      assetType: 'cover'
    });
    assert(cached === '', 'Non-image payload should be rejected');
    report(54, 'ArtworkCacheManager: Strict MIME validation rejects non-image Content-Type');
  }

  {
    // Valid image download and caching
    const validImageUrl = `http://127.0.0.1:${serverPort}/image.png`;
    const cached = await artworkCache.downloadAndCache({
      gameId: testGameId,
      remoteUrl: validImageUrl,
      assetType: 'cover',
      overwrite: true
    });
    assert(cached !== '' && fs.existsSync(cached), 'Cached image file exists on disk');
    report(55, 'ArtworkCacheManager: Download, cache, and register artwork in local filesystem');
  }

  {
    // Custom user artwork file
    const customSamplePath = path.join(TEST_DIR, 'my_custom_cover.png');
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    fs.writeFileSync(customSamplePath, png1x1);

    const saved = await artworkCache.saveCustomArtwork(testGameId, 'COVER_FRONT', customSamplePath);
    assert(fs.existsSync(saved), 'Custom artwork file saved');
    const artRec = artworkRepo.getPrimaryArtwork(testGameId, 'COVER_FRONT');
    assert(artRec !== null && artRec.isUserCustom === true, 'Registered as user custom in database');
    report(56, 'ArtworkCacheManager: saveCustomArtwork handles manual files with isUserCustom: true');
  }

  {
    const stats = await artworkCache.getCacheStats();
    assert(stats.totalFiles > 0, 'Total files tracked');
    assert(stats.coversCount > 0, 'Covers count tracked');
    const assetUrl = artworkCache.toAssetUrl(path.join(artworkDir, 'test.png'));
    assert(assetUrl.startsWith('local-artwork://'), 'local-artwork URI scheme formatted correctly');
    report(57, 'ArtworkCacheManager: Cache statistics reporting and local-artwork URI formatting');
  }

  // ==========================================================================
  // SECTION 11: METADATA JOB MANAGER & PIPELINE EXECUTION (Tests 58-60)
  // ==========================================================================
  const jobManager = new MetadataJobManager({
    jobsRepo,
    gamesRepo,
    gameFilesRepo,
    providerRegistry,
    mergeService,
    artworkCache
  });

  {
    const job = jobManager.enqueueGame(testGameId, 'USER_REQUESTED');
    assert(job !== null && job.status === 'QUEUED', 'Job enqueued with QUEUED status');
    assert(job.priority === 'USER_REQUESTED', 'Priority matches');
    report(58, 'MetadataJobManager: Enqueue single game metadata job with priority');
  }

  {
    // Execute job through full pipeline
    const job = jobsRepo.getByGameId(testGameId);
    assert(job !== null, 'Job exists');
    await jobManager.executeJob(job);
    const completedJob = jobsRepo.getById(job.id);
    assert(
      completedJob !== null && ['COMPLETED', 'REVIEW_REQUIRED'].includes(completedJob.status),
      `Job should finish in COMPLETED or REVIEW_REQUIRED, got: ${completedJob?.status}`
    );
    report(59, 'MetadataJobManager: End-to-end pipeline execution from identification to artwork download');
  }

  {
    const enqueuedCount = jobManager.enqueueAllGames('BACKGROUND', false);
    assert(enqueuedCount >= 1, 'Batch enqueued games');
    report(60, 'MetadataJobManager: Batch queue all games for background metadata enrichment');
  }

  // Cleanup
  if (testServer) {
    testServer.close();
  }
  db.close();
  cleanDir(TEST_DIR);

  console.log('\n================================================================');
  console.log(`  ALL ${passed}/${total} PHASE 5A METADATA & ARTWORK TESTS PASSED!`);
  console.log('================================================================\n');
}

runTests().catch((err) => {
  if (testServer) {
    testServer.close();
  }
  console.error('\n❌ PHASE 5A TEST FAILURE:', err);
  process.exit(1);
});
