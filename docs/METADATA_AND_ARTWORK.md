# Phase 5: Automated Metadata Scraping & Artwork Enrichment 🎨

Game Vault Phase 5 introduces automated metadata scraping, multi-provider enrichment, an offline-first high-speed local disk artwork cache, and an enriched game details experience with ratings, genres, and screenshot galleries.

---

## Architecture Overview

```mermaid
graph TD
  UI[GameCard & GameDetailsModal] -->|IPC: metadata:scrapeGame| Handlers[IPC Metadata Handlers]
  Handlers --> MS[MetadataService]
  
  MS --> TS[TitleSanitizer]
  MS --> Chain[Multi-Provider Scraping Chain]
  
  Chain -->|Priority 1| SS[ScreenScraper API v2]
  Chain -->|Priority 2| IGDB[Twitch IGDB v4 API]
  Chain -->|Priority 3| Steam[Steam Storefront Scraper (Public API)]
  Chain -->|Fallback| Local[Local Heuristic Fallback]
  
  MS --> ACM[ArtworkCacheManager]
  ACM --> Disk[<cacheDir>/artwork/<gameId>/]
  
  MS --> Repo[GamesRepository (SQLite)]
  
  Disk -->|Protocol: local-artwork://| UI
```

---

## 1. Multi-Provider Scraping Chain

Game Vault queries metadata providers in strict hierarchical priority:
1. **ScreenScraper API v2** (`ScreenScraperMetadataProvider`): Queried if configured and connected in Settings → Integrations Hub. Optimal for retro consoles, arcade boards, and handhelds.
2. **IGDB v4** (`IgdbMetadataProvider`): Queried via Twitch OAuth client credentials if connected in Settings → Integrations Hub. Optimal for modern and indie titles across all generations.
3. **Steam Storefront Public Scraper** (`SteamStorefrontScraper`): Public search (`/api/storesearch`) and app details (`/api/appdetails`). Requires zero user authentication or API keys. Provides vertical capsule covers (`library_600x900_2x.jpg`), horizontal banners, screenshots, genres, and Metacritic ratings.
4. **Local Heuristic Fallback**: Cleans filename and preserves existing catalog data.

---

## 2. Title Normalizer & Preservation Tag Stripper (`titleSanitizer.ts`)

ROM and archive filenames typically contain preservation tags that degrade search matches against storefront APIs. `cleanGameTitle` and `sanitizeGameTitle` clean these strings:

| Raw Filename | Sanitized Title | Extracted Disc | Tags |
| :--- | :--- | :--- | :--- |
| `Super Mario 64 (USA).z64` | `Super Mario 64` | — | `USA` |
| `Final Fantasy VII (Disc 1 of 3) [SCUS-94163].bin` | `Final Fantasy VII` | 1 | `Disc 1 of 3`, `SCUS-94163` |
| `Chrono Trigger [!].smc` | `Chrono Trigger` | — | `!` |
| `The Legend of Zelda - Ocarina of Time (v1.2) [En,Ja]` | `The Legend of Zelda - Ocarina of Time` | — | `v1.2`, `En,Ja` |
| `Half-Life 2 (v1.0.1.0) [MULTI5].zip` | `Half-Life 2` | — | `v1.0.1.0`, `MULTI5` |
| `Pokemon - Emerald Version (USA, Europe).gba` | `Pokemon - Emerald Version` | — | `USA, Europe` |

---

## 3. High-Speed Local Disk Artwork Cache (`ArtworkCacheManager.ts`)

To guarantee instant rendering when offline and prevent repeated network requests, images are cached to local disk under `<cacheDir>/artwork/<gameId>/`:

- **Cover**: `cover.<ext>` (`.jpg`, `.png`, `.webp`)
- **Banner**: `banner.<ext>`
- **Screenshots**: `screenshot_<index>.<ext>`

### Features:
- **Offline-First Rendering**: UI checks `localCoverPath` and `localBannerPath` first.
- **Custom Protocol**: Electron registers `local-artwork://` with standard, secure, and CSP bypass privileges so cached images load seamlessly inside Vite dev and packaged production builds.
- **Concurrency Limiting**: Internal download queue limits active HTTP sockets to 4 concurrent downloads to prevent socket starvation.
- **Cache Management**: Provides `getCacheStats()` (count and size in bytes) and `clearCache(gameId?)` with strict directory traversal prevention.

---

## 4. Database Schema (Migration 12)

Migration `012_game_metadata_and_artwork` enhances the `games` table with:

```sql
ALTER TABLE games ADD COLUMN genres TEXT;
ALTER TABLE games ADD COLUMN rating REAL;
ALTER TABLE games ADD COLUMN screenshot_urls TEXT;
ALTER TABLE games ADD COLUMN local_cover_path TEXT;
ALTER TABLE games ADD COLUMN local_banner_path TEXT;
ALTER TABLE games ADD COLUMN local_screenshot_paths TEXT;
ALTER TABLE games ADD COLUMN metadata_source TEXT;
ALTER TABLE games ADD COLUMN metadata_scraped_at TEXT;

CREATE INDEX IF NOT EXISTS idx_games_metadata_scraped ON games(metadata_scraped_at);
CREATE INDEX IF NOT EXISTS idx_games_rating ON games(rating);
```

---

## 5. UI Enhancements

### `GameCard`
- **Zero-Latency Artwork**: Automatically renders `localCoverPath` via `local-artwork://` or falls back to remote `coverUrl`.
- **Rating Star**: Displays community score pill (e.g. `★ 8.8`).
- **Genre Subtitle**: Displays primary genre tags (e.g. `Action • RPG`).

### `GameDetailsModal`
- **Rich Header**: High-resolution banner artwork, platform badge, release year, community rating, and metadata source attribution.
- **Live Metadata Scraper**: Dedicated `[ 🔍 Refresh Metadata ]` action button that triggers scraping and updates state reactively.
- **Genre Pills**: Interactive badges for each genre.
- **Synopsis Block**: Multi-line scrollable description box.
- **Screenshot Gallery**: Interactive thumbnail strip with full-width preview viewer.
- **Launch Settings**: Playback strategy and custom emulator options preserved.

---

## 6. IPC API Reference

| Channel | Method (`window.gameVault`) | Description |
| :--- | :--- | :--- |
| `metadata:scrapeGame` | `scrapeGameMetadata(gameId)` | Scrapes and caches metadata and artwork for a specific game. |
| `metadata:scrapeAll` | `scrapeAllMetadata({ overwrite? })` | Batches scraping across unscraped or all games with progress events. |
| `metadata:getCacheStats` | `getArtworkCacheStats()` | Returns total cached files, size in bytes, and counts. |
| `metadata:clearCache` | `clearArtworkCache(gameId?)` | Purges cached artwork for a game or the entire cache. |
| `metadata:progressEvent` | `onMetadataProgress(cb)` | Subscribes to batch scraping progress events. |

---

## 7. Verification

Run the automated Phase 5 verification suite:
```powershell
npm.cmd run test:phase5
```
Includes 10 test scenarios verifying migration idempotency, repository updates, title normalization, disk caching, Steam scraper, multi-provider fallback, batch scraping, and security bounds.
