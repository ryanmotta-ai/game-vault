import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { Game } from '../src/core/types';
import { cleanGameTitle, sanitizeGameTitle } from '../src/metadata/titleSanitizer';
import { ArtworkCacheManager } from '../src/metadata/ArtworkCacheManager';
import { SteamStorefrontScraper } from '../src/metadata/providers/SteamStorefrontScraper';
import { MetadataService } from '../src/metadata/MetadataService';
import { MetadataProvider } from '../src/integrations/metadata/MetadataProvider';
import { ExternalServiceClient } from '../src/integrations/client/ExternalServiceClient';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runPhase5Tests() {
  console.log('================================================================');
  console.log('🎮 GAME VAULT - PHASE 5 METADATA & ARTWORK ENRICHMENT TESTS');
  console.log('================================================================\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-test-phase5-'));
  const dbPath = path.join(tempDir, 'test.db');
  const artworkDir = path.join(tempDir, 'artwork-cache');
  const db = new Database(dbPath);

  try {
    // -------------------------------------------------------------
    // Test 1: Migration 12 Idempotency & Schema Verification
    // -------------------------------------------------------------
    console.log('[1/10] Testing Migration 12 & Database Schema...');
    initializeDatabaseSchema(db);
    // Run again to ensure strict idempotency
    initializeDatabaseSchema(db);

    const cols = db.prepare("PRAGMA table_info('games')").all() as Array<{ name: string; type: string }>;
    const colMap = new Map(cols.map((c) => [c.name, c.type]));

    assert(colMap.has('genres'), 'games table should have genres column');
    assert(colMap.has('rating'), 'games table should have rating column');
    assert(colMap.has('screenshot_urls'), 'games table should have screenshot_urls column');
    assert(colMap.has('local_cover_path'), 'games table should have local_cover_path column');
    assert(colMap.has('local_banner_path'), 'games table should have local_banner_path column');
    assert(colMap.has('local_screenshot_paths'), 'games table should have local_screenshot_paths column');
    assert(colMap.has('metadata_source'), 'games table should have metadata_source column');
    assert(colMap.has('metadata_scraped_at'), 'games table should have metadata_scraped_at column');

    console.log('✔ Migration 12 applied idempotently with all columns verified.\n');

    // -------------------------------------------------------------
    // Test 2: GamesRepository Metadata Methods & Serialization
    // -------------------------------------------------------------
    console.log('[2/10] Testing GamesRepository Metadata Methods...');
    const gamesRepo = new GamesRepository(db);

    const testGame: Game = {
      id: 'game-metroid',
      title: 'Super Metroid (USA) [!]',
      slug: 'super-metroid',
      platform: 'SNES',
      state: 'CLOUD',
      sizeBytes: 3145728,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    gamesRepo.upsert(testGame);

    const unscraped = gamesRepo.getUnscrapedGames();
    assert(unscraped.some((g) => g.id === 'game-metroid'), 'New game without scraped timestamp should be in unscraped list');

    // Update metadata
    gamesRepo.updateMetadata('game-metroid', {
      description: 'The space bounty hunter Samus Aran lands on planet Zebes.',
      releaseYear: 1994,
      developer: 'Nintendo R&D1',
      publisher: 'Nintendo',
      genres: ['Action', 'Platformer', 'Sci-Fi'],
      rating: 9.6,
      coverUrl: 'https://images.example.com/metroid-cover.jpg',
      bannerUrl: 'https://images.example.com/metroid-banner.jpg',
      screenshotUrls: ['https://images.example.com/ss1.jpg', 'https://images.example.com/ss2.jpg'],
      localCoverPath: path.join(artworkDir, 'game-metroid', 'cover.jpg'),
      metadataSource: 'screenscraper'
    });

    const retrieved = gamesRepo.getById('game-metroid')!;
    assert(retrieved.description?.includes('Samus Aran') === true, 'Description should be updated');
    assert(retrieved.releaseYear === 1994, 'Release year should be 1994');
    assert(retrieved.rating === 9.6, 'Rating should be 9.6');
    assert(Array.isArray(retrieved.genres) && retrieved.genres.includes('Sci-Fi'), 'Genres should be deserialized array');
    assert(Array.isArray(retrieved.screenshotUrls) && retrieved.screenshotUrls.length === 2, 'Screenshots should be deserialized');
    assert(retrieved.metadataSource === 'screenscraper', 'Metadata source should be recorded');
    assert(Boolean(retrieved.metadataScrapedAt), 'metadata_scraped_at should be populated');

    const unscrapedAfter = gamesRepo.getUnscrapedGames();
    assert(!unscrapedAfter.some((g) => g.id === 'game-metroid'), 'Game with scraped timestamp should not be in unscraped list');

    console.log('✔ GamesRepository metadata update and deserialization verified.\n');

    // -------------------------------------------------------------
    // Test 3: Title Normalizer & Dump Tag Stripper
    // -------------------------------------------------------------
    console.log('[3/10] Testing Title Normalizer & Dump Tag Stripper...');

    const testTitles = [
      { raw: 'Super Mario 64 (USA).z64', expected: 'Super Mario 64' },
      { raw: 'Final Fantasy VII (Disc 1 of 3) [SCUS-94163].bin', expected: 'Final Fantasy VII' },
      { raw: 'Sonic the Hedgehog (Rev 1) [!]', expected: 'Sonic the Hedgehog' },
      { raw: 'The Legend of Zelda - Ocarina of Time (v1.2) [En,Ja]', expected: 'The Legend of Zelda - Ocarina of Time' },
      { raw: 'Chrono Trigger [!].smc', expected: 'Chrono Trigger' },
      { raw: 'Half-Life 2 (v1.0.1.0) [MULTI5].zip', expected: 'Half-Life 2' },
      { raw: 'Pokemon - Emerald Version (USA, Europe).gba', expected: 'Pokemon - Emerald Version' },
      { raw: 'Castlevania - Symphony of the Night (Track 01).iso', expected: 'Castlevania - Symphony of the Night' },
      { raw: 'Tekken_3_(USA)_(Beta).iso', expected: 'Tekken 3' }
    ];

    for (const item of testTitles) {
      const sanitized = cleanGameTitle(item.raw);
      assert(
        sanitized === item.expected,
        `Expected cleanTitle '${item.expected}' for raw '${item.raw}', got '${sanitized}'`
      );
    }

    const discCheck = sanitizeGameTitle('Metal Gear Solid (Disc 2) [SLUS-00957]');
    assert(discCheck.detectedDisc === 2, 'Should extract detected disc index 2');
    assert(discCheck.cleanTitle === 'Metal Gear Solid', 'Should clean title to Metal Gear Solid');

    console.log('✔ Title normalizer and preservation tag stripper verified on 10 test vectors.\n');

    // -------------------------------------------------------------
    // Test 4: ArtworkCacheManager (Data URLs, Local Caching, Stats)
    // -------------------------------------------------------------
    console.log('[4/10] Testing ArtworkCacheManager Disk Caching & Stats...');
    const cacheManager = new ArtworkCacheManager(artworkDir);

    // Test data URL caching (simulating 1x1 transparent PNG)
    const samplePngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const cachedCover = await cacheManager.downloadAndCache({
      gameId: 'game-metroid',
      remoteUrl: samplePngDataUrl,
      assetType: 'cover'
    });

    assert(Boolean(cachedCover) && fs.existsSync(cachedCover), 'Cached cover file must exist on disk');
    assert(cachedCover.endsWith('.png'), 'Detected format should be .png');

    // Test banner caching
    const cachedBanner = await cacheManager.downloadAndCache({
      gameId: 'game-metroid',
      remoteUrl: samplePngDataUrl,
      assetType: 'banner'
    });
    assert(Boolean(cachedBanner) && fs.existsSync(cachedBanner), 'Cached banner file must exist on disk');

    // Test screenshot caching
    const cachedScreenshot = await cacheManager.downloadAndCache({
      gameId: 'game-metroid',
      remoteUrl: samplePngDataUrl,
      assetType: 'screenshot',
      index: 0
    });
    assert(Boolean(cachedScreenshot) && fs.existsSync(cachedScreenshot), 'Cached screenshot must exist on disk');

    // Test asset URL scheme conversion
    const assetUrl = cacheManager.toAssetUrl(cachedCover);
    assert(assetUrl.startsWith('local-artwork://'), `Asset URL must use local-artwork scheme, got: ${assetUrl}`);

    // Test getCachedArtwork
    const gameArt = cacheManager.getCachedArtwork('game-metroid');
    assert(Boolean(gameArt.coverPath), 'getCachedArtwork should return coverPath');
    assert(Boolean(gameArt.bannerPath), 'getCachedArtwork should return bannerPath');
    assert(gameArt.screenshotPaths.length >= 1, 'getCachedArtwork should return screenshotPaths');

    // Test getCacheStats
    const stats = await cacheManager.getCacheStats();
    assert(stats.totalFiles >= 3, `Expected at least 3 cached files, got ${stats.totalFiles}`);
    assert(stats.totalSizeBytes > 0, 'Total size bytes must be positive');
    assert(stats.coversCount >= 1, 'Covers count should be at least 1');
    assert(stats.bannersCount >= 1, 'Banners count should be at least 1');
    assert(stats.screenshotsCount >= 1, 'Screenshots count should be at least 1');

    console.log(`✔ ArtworkCacheManager verified (${stats.totalFiles} files cached, total ${stats.totalSizeBytes} bytes).\n`);

    // -------------------------------------------------------------
    // Test 5: Steam Storefront Scraper Mapping
    // -------------------------------------------------------------
    console.log('[5/10] Testing Steam Storefront Scraper with Mock Client...');
    const mockClient = new ExternalServiceClient();

    // Mock search and appdetails responses
    mockClient.request = async (url: string, _options?: any): Promise<any> => {
      if (url.includes('storesearch')) {
        return {
          status: 200,
          latencyMs: 40,
          data: {
            total: 1,
            items: [
              {
                id: 105600,
                name: 'Terraria',
                tiny_image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/105600/capsule_sm_120.jpg',
                metascore: '83'
              }
            ]
          }
        };
      }
      if (url.includes('appdetails')) {
        return {
          status: 200,
          latencyMs: 65,
          data: {
            '105600': {
              success: true,
              data: {
                name: 'Terraria',
                steam_appid: 105600,
                short_description: 'Dig, Fight, Explore, Build! Nothing is impossible in this action-packed adventure game.',
                header_image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/105600/header.jpg',
                developers: ['Re-Logic'],
                publishers: ['Re-Logic'],
                metacritic: { score: 83 },
                release_date: { coming_soon: false, date: '16 May, 2011' },
                genres: [
                  { id: '1', description: 'Action' },
                  { id: '25', description: 'Adventure' },
                  { id: '3', description: 'RPG' }
                ],
                screenshots: [
                  { id: 0, path_thumbnail: 'https://example.com/ss0_thumb.jpg', path_full: 'https://example.com/ss0_full.jpg' },
                  { id: 1, path_thumbnail: 'https://example.com/ss1_thumb.jpg', path_full: 'https://example.com/ss1_full.jpg' }
                ]
              }
            }
          }
        };
      }
      return { status: 404, latencyMs: 10, data: null };
    };

    const steamScraper = new SteamStorefrontScraper(mockClient);
    const searchResults = await steamScraper.searchGame('Terraria');
    assert(searchResults.length === 1, 'Steam search should return 1 item');
    assert(searchResults[0].id === '105600', 'Steam AppID should match 105600');

    const details = await steamScraper.getGameDetails('105600');
    assert(details !== null, 'Steam details should not be null');
    assert(details!.title === 'Terraria', 'Title should match Terraria');
    assert(details!.releaseYear === 2011, 'Release year should be parsed as 2011');
    assert(details!.developer === 'Re-Logic', 'Developer should match Re-Logic');
    assert(details!.rawScore === 8.3, 'Metascore 83 should map to 8.3 rating');
    assert(details!.genres?.includes('Adventure') === true, 'Genres should include Adventure');
    assert(details!.screenshotUrls?.length === 2, 'Screenshots should contain 2 URLs');
    assert(details!.coverUrl?.includes('library_600x900_2x.jpg') === true, 'Cover should be vertical capsule');

    console.log('✔ SteamStorefrontScraper successfully parsed storesearch & appdetails data.\n');

    // -------------------------------------------------------------
    // Test 6: Mock Primary & Fallback Provider Architecture
    // -------------------------------------------------------------
    console.log('[6/10] Testing Multi-Provider Fallback Chain...');

    class FailingProvider implements MetadataProvider {
      public readonly id = 'failing-provider';
      public readonly name = 'Failing Provider';
      async searchGame() {
        return [];
      }
      async identifyGame() {
        return null;
      }
      async getGameDetails() {
        return null;
      }
      async getArtwork() {
        return [];
      }
      async getMedia() {
        return [];
      }
    }

    class SecondaryProvider implements MetadataProvider {
      public readonly id = 'secondary-provider';
      public readonly name = 'Secondary Provider';
      async searchGame(query: string) {
        return [
          {
            id: 'sec-1',
            title: query,
            platform: 'SNES',
            releaseYear: 1995,
            developer: 'Square',
            genres: ['JRPG', 'Classic'],
            rawScore: 9.8,
            coverUrl: samplePngDataUrl,
            bannerUrl: samplePngDataUrl,
            description: 'A masterpiece time-travel RPG.'
          }
        ];
      }
      async identifyGame() {
        return null;
      }
      async getGameDetails(id: string) {
        return {
          id,
          title: 'Chrono Trigger',
          platform: 'SNES',
          releaseYear: 1995,
          developer: 'Square',
          genres: ['JRPG', 'Classic'],
          rawScore: 9.8,
          coverUrl: samplePngDataUrl,
          bannerUrl: samplePngDataUrl,
          description: 'A masterpiece time-travel RPG.'
        };
      }
      async getArtwork() {
        return [];
      }
      async getMedia() {
        return [];
      }
    }

    const chronoGame: Game = {
      id: 'game-chrono',
      title: 'Chrono Trigger [!].smc',
      slug: 'chrono-trigger',
      platform: 'SNES',
      state: 'CLOUD',
      sizeBytes: 4194304,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    gamesRepo.upsert(chronoGame);

    const metadataService = new MetadataService({
      gamesRepo,
      artworkCache: cacheManager,
      providers: [new FailingProvider(), new SecondaryProvider()]
    });

    const enrichedChrono = await metadataService.scrapeGame('game-chrono');
    assert(enrichedChrono.metadataSource === 'secondary-provider', 'Should fall back to secondary provider');
    assert(enrichedChrono.releaseYear === 1995, 'Release year should be updated from fallback');
    assert(enrichedChrono.rating === 9.8, 'Rating should be 9.8');
    assert(Boolean(enrichedChrono.localCoverPath), 'Local cover should be cached on disk');
    assert(fs.existsSync(enrichedChrono.localCoverPath!), 'Local cover file must exist on disk');

    console.log('✔ Fallback chain successfully engaged secondary provider and cached artwork.\n');

    // -------------------------------------------------------------
    // Test 7: Batch Scraping (`scrapeAll`) with Progress Reporting
    // -------------------------------------------------------------
    console.log('[7/10] Testing Batch Scraping & Progress Events...');

    const zeldaGame: Game = {
      id: 'game-zelda',
      title: 'The Legend of Zelda (USA).nes',
      slug: 'the-legend-of-zelda',
      platform: 'NES',
      state: 'CLOUD',
      sizeBytes: 131072,
      playTimeSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    gamesRepo.upsert(zeldaGame);

    const progressEvents: any[] = [];
    const batchResult = await metadataService.scrapeAll({
      overwrite: false,
      onProgress: (p) => {
        progressEvents.push({ ...p });
      }
    });

    assert(batchResult.total >= 1, 'Should scrape at least 1 unscraped game');
    assert(batchResult.scraped >= 1, 'Should have succeeded scraping');
    assert(progressEvents.some((e) => e.status === 'scraping'), 'Should have emitted scraping status event');
    assert(progressEvents.some((e) => e.status === 'completed'), 'Should have emitted completed status event');

    const remainingUnscraped = gamesRepo.getUnscrapedGames();
    assert(remainingUnscraped.length === 0, 'All games should now be scraped');

    console.log(`✔ Batch scraping processed ${batchResult.scraped} games with live progress events.\n`);

    // -------------------------------------------------------------
    // Test 8: Security & Path Traversal Prevention
    // -------------------------------------------------------------
    console.log('[8/10] Testing Path Traversal & Security Bounds in Cache Manager...');

    let caughtTraversal = false;
    try {
      await cacheManager.clearCache('../../../etc');
    } catch {
      caughtTraversal = true;
    }
    assert(caughtTraversal, 'Should have blocked path traversal');
    await cacheManager.clearCache('game-chrono');
    assert(!fs.existsSync(path.join(artworkDir, 'game-chrono')), 'Game artwork directory should be removed');

    console.log('✔ Security boundary checks confirmed on artwork cache paths.\n');

    // -------------------------------------------------------------
    // Test 9: Complete Cache Clear
    // -------------------------------------------------------------
    console.log('[9/10] Testing Complete Artwork Cache Purge...');
    await cacheManager.clearCache();
    const purgedStats = await cacheManager.getCacheStats();
    assert(purgedStats.totalFiles === 0, 'Total files should be 0 after cache purge');
    assert(purgedStats.totalSizeBytes === 0, 'Total size should be 0 after cache purge');

    console.log('✔ Artwork cache cleared cleanly.\n');

    // -------------------------------------------------------------
    // Test 10: End-to-End Database Integrity Check
    // -------------------------------------------------------------
    console.log('[10/10] Testing End-to-End Database Integrity...');
    const allGames = gamesRepo.getAll();
    assert(allGames.length >= 3, 'All games should persist in database');
    for (const g of allGames) {
      assert(Boolean(g.metadataScrapedAt), `Game ${g.id} must retain metadataScrapedAt timestamp`);
      assert(g.platform !== undefined, `Game ${g.id} must retain platform`);
    }

    console.log('✔ All database records preserved and enriched with metadata.\n');

    console.log('================================================================');
    console.log('🎉 ALL 10 PHASE 5 TESTS PASSED WITH 100% SUCCESS!');
    console.log('================================================================');
  } finally {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

runPhase5Tests().catch((err) => {
  console.error('\n❌ Phase 5 Test Suite Failed:', err);
  process.exit(1);
});
