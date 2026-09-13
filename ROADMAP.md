# GAME VAULT — Project Roadmap 🗺

This roadmap tracks the development lifecycle of Game Vault. Each phase builds upon the previous, keeping strict architectural separation and test-driven verification.

> [!NOTE]
<<<<<<< Updated upstream
> Currently Completed: **Phase 1 (Foundation)**, **Phase 2A (Google Authentication & Multi-Account Storage Foundation)**, and **Phase 2B (Cloud Game Scanning & Catalog Ingestion)**. Subsequent phases are documented for planning purposes and must not be implemented ahead of their scheduled milestone.
=======
> Currently Completed: **Phase 1 (Foundation)**, **Phase 2A (Google Authentication & Multi-Account Storage Foundation)**, **Phase 2B (Cloud Game Scanning & Catalog Ingestion)**, **Phase 2C (Sync Correctness & Real-World Consistency Gate)**, **Phase 3A (Reliable Download Engine V1)**, **Phase 3B (Resumable Downloads, Pause/Resume & Multi-Download Control)**, **Phase 3C (Install Preparation, Extraction & Smart Cache)**, **Phase 4A (Launcher Engine V1 & Emulator Integration)**, **Phase 4B (Emulation Hub & External Frontend Integration)**, **Phase 4C (Instant Play & Progressive ROM Streaming)**, **Phase 5 (Automated Metadata Scraping & Artwork Enrichment)**, and **Parallel Track (Integration Hub & Connected Services)**. Subsequent phases are documented for planning purposes and must not be implemented ahead of their scheduled milestone.
>>>>>>> Stashed changes

---

## 📍 Phase 1: Foundation (COMPLETED ✅)
- [x] Electron + React + TypeScript + Vite project scaffolding.
- [x] Modular directory architecture:
  `/desktop`, `/ui`, `/core`, `/storage`, `/providers`, `/database`, `/downloads`, `/launchers`, `/emulators`, `/metadata`.
- [x] Zero-trust Electron security: `contextIsolation`, `sandbox`, disabled `nodeIntegration`, strict CSP, and navigation lock.
- [x] Typed, bi-directional Electron IPC bridge via `preload.ts` and `IPC_CHANNELS`.
- [x] Native SQLite integration with `better-sqlite3` (WAL mode enabled, foreign keys enforced).
- [x] Initial database schemas & typed repositories:
  - `games`
  - `storage_accounts`
  - `game_files`
  - `downloads`
  - `emulators`
  - `settings`
- [x] Abstract `StorageProvider` interface & extensible `ProviderFactory`.
- [x] `GoogleDriveProvider` architectural skeleton (zero hardcoded secrets).
- [x] OS-aware `ConfigManager`.
- [x] Structured logger with secret redaction (`Logger`).
- [x] Typed domain error hierarchy & global unhandled exception handling.
- [x] Modern dark Steam/console-like interface:
  - Header (search, storage indicator widget, profile)
  - Sidebar (Library, Installed, Downloads, Platforms, Storage, Settings)
  - Responsive game cards with visual badges (`☁ CLOUD`, `↓ DOWNLOADING`, `⚡ READY`)
  - Dedicated Storage screen (Cloud Storage, Local Cache, Connected Accounts)
- [x] Automated test suite & smoke test pipeline.
- [x] Complete project documentation (`README.md`, `ARCHITECTURE.md`, `ROADMAP.md`).

---

## 📍 Phase 2A: Google Authentication & Multi-Account Storage Foundation (COMPLETED ✅)
- [x] Native OAuth 2.0 PKCE loopback authentication flow ([RFC 8252](https://tools.ietf.org/html/rfc8252) + [RFC 7636](https://tools.ietf.org/html/rfc7636)) for Google Drive in Electron Main.
- [x] Ephemeral loopback HTTP server with CSRF state validation, browser launch via `shell.openExternal`, and authorization code exchange.
- [x] Secure OS Keychain credential persistence (`CredentialStore` using Windows DPAPI via Electron `safeStorage` with AES-256-GCM fallback).
- [x] Multi-account architecture: connect, disconnect, and reconnect multiple independent Google accounts concurrently.
- [x] Non-destructive database migration runner (`MigrationRunner` + `schema_migrations`) applying `001_initial_schema` and `002_storage_accounts_v2`.
- [x] Updated `StorageAccountsRepository` with `provider_account_id`, `credential_key`, and `last_authenticated_at`.
- [x] Google Drive v3 client integration for account profile and live quota retrieval.
- [x] Dynamic storage quota aggregation across all active accounts in `StorageManager`.
- [x] Zero token leakage in logs (`logger` redaction) and IPC boundaries.
- [x] Setup guide in `docs/GOOGLE_DRIVE_SETUP.md` and `.env.example`.

---

## 📍 Phase 2B: Cloud Game Scanning & Catalog Ingestion (COMPLETED ✅)
- [x] Google Drive recursive folder scanner (`CloudInventoryScanner` using BFS queue, batch transactions, pagination up to 1000 items).
- [x] Rate limiting resilience: exponential backoff with jitter for 429/403/5xx errors (`fetchWithRetry`).
- [x] Google Drive Changes API incremental delta synchronization (`getStartPageToken`, `listChanges`).
- [x] Contextual heuristic file classification (`FileClassifier`) with confidence scoring (`HIGH >= 0.75`, `MEDIUM`, `LOW`).
- [x] Game candidate resolver (`GameCandidateResolver`): title normalization, multi-track `.bin` / `.cue` grouping, multi-disc detection, collision-proof slugs.
- [x] Catalog ingestion engine (`CatalogIngestionService`): atomic upserts to `games` and `game_files`, non-destructive `MISSING` status handling.
- [x] Multi-account inventory aggregation (browsing games across all connected accounts unified in the library).
- [x] Full UI integration: per-account scanning controls, "Scan All Accounts", real-time progress bar, cancellation button, and fallback cover artwork.
- [x] Migrations `003_cloud_inventory` and `004_storage_sync_state` with 100% test coverage (25 automated scenarios).
- [x] Architecture documentation in `docs/CLOUD_SCANNING.md`.

---

## ⚡ Phase 3: High-Performance Resumable Download Engine & Cache
- [ ] Multi-threaded / chunked HTTP download stream for Google Drive v3 API.
- [ ] Resumable downloads supporting pause, cancel, network drops, and app restarts.
- [ ] MD5/SHA256 checksum verification against Google Drive remote file hashes.
- [ ] Automatic archive extraction (ZIP, 7z, RAR) into game cache directory upon download completion.
- [ ] Real-time download progress broadcasting over IPC to renderer UI.

---

<<<<<<< Updated upstream
## 🕹 Phase 4: Native Launchers & Emulator Runner Integration
- [ ] Process launcher for Windows native PC games (`.exe`) with child process monitoring.
- [ ] Automatic playtime tracker (session duration and total hours stored in SQLite).
- [ ] Emulator detector and launcher for supported console platforms:
  - RetroArch
  - PCSX2 (PlayStation 2)
  - RPCS3 (PlayStation 3)
  - DuckStation (PlayStation 1)
  - Dolphin (GameCube / Wii)
  - Ryujinx (Nintendo Switch)
  - mGBA (Game Boy Advance)
- [ ] Command-line argument template builder for emulator execution.
=======
## 📍 Phase 3A: Reliable Download Engine V1 (COMPLETED ✅)
- [x] Single active download queue (FIFO) with deterministic sequencing and no concurrency thrashing.
- [x] Pre-flight disk space check: verifies `size + 512 MB` margin using `CacheManager.getAvailableDiskSpace()`.
- [x] HTTP streaming download via Google Drive `alt=media` with Node stream backpressure control.
- [x] Path safety and Windows filename sanitization (`sanitizeFilename` handling directory traversals, illegal characters, and reserved names like `CON`, `PRN`, `AUX`, `NUL`).
- [x] Streaming cryptographic checksum validation (`calculateFileMd5` via pipeline, fallback to size check).
- [x] Atomic finalization: writes to `<cacheDir>/downloads/partial/<downloadId>.part` and atomically moves to `<cacheDir>/games/<gameId>/<filename>`.
- [x] Immediate cancellation and partial file cleanup via `AbortController`.
- [x] Crash recovery: startup `recoverStaleDownloads` cleans orphan `.part` files and transitions interrupted downloads to `FAILED`.
- [x] State transitions: seamless lifecycle transitions between `CLOUD`, `DOWNLOADING`, and `READY` across single and multi-file titles.
- [x] UI integration: real-time progress bar, speed, percentage, cancel button on game cards, and Downloads view.
- [x] 100% automated test coverage (22 Phase 3A scenarios across 15 test suites).
- [x] Architectural documentation in `docs/DOWNLOAD_ENGINE.md`.

---

## 📍 Phase 3B: Resumable Downloads, Pause/Resume & Multi-Download Control (COMPLETED ✅)
- [x] Standard HTTP Range resumption (`Range: bytes=X-` with strict 206 Partial Content validation, 200 rejection, and 416 completion checks).
- [x] Resumable downloads preserving `.part` files across manual pause, graceful exit, and sudden application crashes.
- [x] Multi-download concurrent scheduler (`DownloadScheduler`) with configurable concurrency slots (1 to 4 active downloads, default 2).
- [x] FIFO dispatch with dynamic priority bumping ("Download Next") ensuring high-priority items take precedence.
- [x] Exponential backoff with random jitter for transient network failures, socket timeouts, and HTTP 429 / 503 rate limits.
- [x] Self-healing oversized partial handling: invalidates corrupt `.part` files larger than remote expected bytes without crashing.
- [x] Remote file mutation detection: checks MD5 and modified time before resuming; invalidates partial if remote was replaced.
- [x] Crash recovery on app startup (`recoverStaleDownloads`): recovers interrupted transfers as `PAUSED` and preserves verified `.part` files.
- [x] Centralized state management via `GameAvailabilityService`: unifies `READY`, `DOWNLOADING`, and `CLOUD` state synchronization.
- [x] Database migration `007_downloads_v2` with `priority`, `retry_count`, `last_error_code`, `resume_supported`, and priority index.
- [x] Full UI integration:
  - `DownloadsView`: Active slots, queued items with "Download Next", paused items with retry, completed items with "Clear History", and concurrency limit selector.
  - `GameCard`: Integrated progress bar, pause/resume/cancel controls, and retry indicators.
- [x] 100% automated test coverage (43 Phase 3B scenarios covering all 42 specifications + full backwards compatibility across all prior test suites).
- [x] Complete technical and operational guide in `docs/DOWNLOAD_ENGINE.md`.

---

## 📍 Phase 3C: Install Preparation, Extraction & Smart Cache (COMPLETED ✅)
- [x] Multi-archive extraction engine (`ArchiveExtractorEngine`) supporting `.zip` (adm-zip), `.7z` (7zip-bin standalone binary), and `.rar` (node-unrar-js WebAssembly).
- [x] Robust pre-flight Zip Slip path traversal defense (`validateEntryPath`) blocking `..`, leading slashes, UNC paths, and Windows drive letters before writing any byte to disk.
- [x] Temporary sandbox isolation: extracts strictly to `<cacheDir>/prepare/<jobId>/` with atomic rename to `<cacheDir>/games/<gameId>/` on success, and guaranteed cleanup on failure or cancellation.
- [x] Platform-specific playable file detector (`PlayableFileDetector`) prioritizing main game ROMs/executables across PS1, PS2, PSP, GameCube, Wii, Dreamcast, NDS, 3DS, N64, GBA, SNES, NES, and PC.
- [x] Multi-file game preservation: keeps BIN+CUE sets, Dreamcast GDI tracks, and multi-disc games (`Disc 1`, `Disc 2`) intact without deleting companion tracks.
- [x] PC game distinction: differentiates portable `.exe` from setup installers (`setup.exe`, `install.exe`), flagging `installRequired: true` without auto-executing third-party binaries.
- [x] Local Game Manifest generation (`manifest.json` on disk and `game_manifests` table in SQLite) tracking primary executable, total local size, integrity status, and source artifact IDs.
- [x] Cheap and deep local game verification (`verifyLocalGame`): cheap startup checks (existence + file size) and on-demand deep SHA-256/MD5 validation.
- [x] Archive retention policy: configurable setting (`keep_original_archives`, default `false`) automatically purging compressed archives upon verified preparation to save disk space.
- [x] Smart Cache Manager V2 (`CacheManager`):
  - Categorized storage breakdown: `PARTIAL`, `TEMP`, `GAME`, `ARTWORK`.
  - Configurable cache limit (`cache_max_bytes`, default 500 GB).
  - Disk safety buffer enforcement (`download + extraction + 512 MB buffer`).
  - LRU eviction candidates ranking based on `last_accessed_at`, strictly excluding pinned games (`pinned = 1`).
  - Manual local copy removal (`[ Remove Local Copy ]` action) freeing disk space while preserving database records, cloud file IDs, and playtime.
  - Path safety assertions (`safeDelete`) preventing root deletions or escaping cache roots.
- [x] Startup crash recovery (`recoverStalePreparationJobs`): clears orphan temporary prepare folders and resets stale preparing jobs to `FAILED` and `CLOUD`.
- [x] Database migration `008_preparation_and_cache`: creates `preparation_jobs` and `game_manifests`, extends `games` with `pinned` and `last_accessed_at`.
- [x] Seamless download-to-preparation handoff: `DownloadManager` automatically triggers `GamePreparationService.prepare()` upon download completion.
- [x] Comprehensive UI updates:
  - `GameCard`: Pinned indicator badge, preparing state with amber progress bar and step name, queued state, and ready state actions (📌 Pin toggle, 🗑 Evict / Remove Local Copy).
  - `DownloadsView`: Active Install Preparations section with live step and percentage progress.
  - `StorageScreen`: Local Disk Cache (V2) card with breakdown visualizer and "Manage Cache & Installed Games" modal with pin toggles, verification checks, and eviction.
- [x] 100% automated test coverage (35/35 Phase 3C test scenarios passing with zero regressions).
- [x] Technical documentation in `docs/GAME_PREPARATION.md` and `docs/CACHE_MANAGEMENT.md`.

---

## 🕹 Phase 4A: Launcher Engine V1 & Emulator Integration (COMPLETED ✅)
- [x] Full lifecycle completion: `CLOUD` → `DOWNLOAD` → `PREPARE` → `READY` → `PLAY`.
- [x] Zero-Shell Security: all processes executed strictly via `child_process.spawn(executable, args[], { shell: false })`, eliminating shell injection risk.
- [x] Console emulator adapter subsystem (`EmulatorLauncher`):
  - PCSX2 (PlayStation 2) with `-batch`, `-fullscreen`, `--` delimiter
  - DuckStation (PlayStation) with `-batch`, `-fullscreen`, `--` delimiter
  - Dolphin (GameCube & Wii) with `-b`, `-f`, `-e` flags
  - PPSSPP (PlayStation Portable) with `--fullscreen` flag
  - RetroArch (NES, SNES, GB, GBC, GBA, N64) with dynamic Libretro core resolution via `RetroArchCoreRegistry`
- [x] Native PC game launcher (`NativePcLauncher`) for portable Windows games (`.exe`).
- [x] Child process monitor (`ProcessMonitor`):
  - Duplicate launch prevention (`GameAlreadyRunningError`)
  - Session tracking in `game_sessions` table with start/end timestamps and duration
  - Crash detection (`crashed = 1`, non-zero exit codes) with playtime preservation
  - Atomic updates to `games.play_time_seconds` and `games.last_played_at`
  - Graceful shutdown without killing external game processes (`unref()`)
- [x] Safe emulator auto-discovery (`EmulatorDetectionService`) in standard directories (no whole-disk scans).
- [x] Portable emulator and manual executable path override support.
- [x] Per-game launch profiles (`launch_profiles` table) with custom args and fullscreen toggles.
- [x] Pre-launch local file validation with automatic state reconciliation (`RomNotFoundError` -> `CLOUD`).
- [x] Comprehensive UI integration:
  - `GameCard`: `[ ▶ Play ]`, running indicator `[ ● Playing ]`, setup badges
  - `GameDetailsModal`: Total playtime ("31h 42m"), last played date, active launcher, fullscreen toggle, custom arguments, and [ ▶ PLAY NOW ]
  - `SettingsView`: "Emulators & Launchers" management panel with [ Auto-Detect ] and [ Browse... ]
- [x] 100% automated test coverage (40/40 Phase 4A test scenarios passing).
- [x] Technical documentation in `docs/LAUNCHER_ENGINE.md` and `docs/EMULATOR_INTEGRATION.md`.

---

## 🕹 Phase 4B: Emulation Hub & External Frontend Integration (COMPLETED ✅)
- [x] External frontend support and Universal Integration Foundation.
- [x] Non-destructive credential storage and ScreenScraper integration.
>>>>>>> Stashed changes

---

## ⚡ Phase 4C: Instant Play & Progressive ROM Streaming (COMPLETED ✅)
- [x] **Core Principle**: *"Cloud is an implementation detail, not a user experience."*
- [x] `PlaybackStrategyResolver`: automatically determines `INSTANT_HYDRATION`, `PROGRESSIVE_PLAY`, or `LOCAL_REQUIRED` based on game platform, file size, network quality, and user preferences.
- [x] **Transparent Instant Hydration (`INSTANT_HYDRATION`)**:
  - Small retro ROMs $\le 128\text{ MB}$ (NES, SNES, GB, GBC, GBA, N64, NDS, Genesis, etc.) stream directly to local cache.
  - Manifest is generated automatically and game state transitions atomically to `READY`.
  - Seamless launch within $< 2$ seconds upon clicking `[ ⚡ Instant Play ]`.
- [x] **Progressive ROM Streaming Engine (`PROGRESSIVE_PLAY`)**:
  - **Zero Kernel Drivers**: 100% user-space Node.js implementation avoiding WinFsp or virtual filesystem kernel drivers.
  - **Sparse 4 MB Block Cache (`BlockCache`)**: Manages 4 MB chunks on disk (`.blk` files + `manifest.json`).
  - **In-Flight Deduplication**: Merges concurrent requests for identical blocks into a single network operation.
  - **Boundary Span Reads**: Stitches byte slices seamlessly across block boundaries for arbitrary Range queries.
  - **LRU Cache Eviction & Locked Block Protection**: Evicts least recently accessed blocks when exceeding cache limits while protecting active blocks.
  - **Cache Invalidation & Materialization**: Clears blocks upon remote version changes and materializes complete contiguous files on disk.
- [x] **Predictive Prefetch Coordinator (`PrefetchCoordinator`)**:
  - Streak-based adaptive read-ahead window expansion during sequential playback.
  - Baseline reset upon non-sequential seek jumps.
  - Multi-tier priority queue (`REQUESTED` > `PREFETCH` > `BACKGROUND`).
- [x] **Dynamic Network Capability Estimation (`NetworkCapabilityEstimator`)**:
  - Continuous throughput and latency sampling across rolling request windows.
  - Dynamic classification into `EXCELLENT`, `GOOD`, `FAIR`, and `POOR`, throttling prefetch tasks when congested.
- [x] **Ephemeral Localhost Stream Server (`LocalhostStreamServer`)**:
  - Binds strictly to `127.0.0.1` on an OS-assigned ephemeral port (port `0`).
  - Strict loopback IP filtering and cryptographically random 128-bit session capability token authentication.
  - Full RFC 7233 byte serving with `206 Partial Content` and `416 Range Not Satisfiable`.
- [x] **Database & Repositories**:
  - Migration `010_instant_play_and_streaming`: adds `playback_mode` column to `launch_profiles` and default streaming settings.
  - Updated `LaunchProfilesRepository` and `SettingsRepository`.
- [x] **Launcher Engine Integration**:
  - Integrated into `LauncherManager`: `getPlaybackStrategy(gameId)`, `hydrateAndLaunch(gameId)`, and automatic hydration on launch for unready games.
- [x] **UI & User Controls**:
  - `GameCard`: `⚡ Instant` badge and `⚡ Instant Play` action button.
  - `GameDetailsModal`: `[ ⚡ Instant Play ]` and Playback Strategy dropdown (`auto`, `always_local`, `experimental_streaming`).
  - `SettingsView`: "Instant Play & Progressive ROM Streaming" configuration panel (hydration threshold, cache limit, read-ahead window, background caching toggle, cache purge button).
- [x] 100% automated test coverage (41/41 Phase 4C scenarios passing).
- [x] Technical documentation in `docs/INSTANT_PLAY.md`, `docs/PROGRESSIVE_STREAMING.md`, and `docs/STREAMING_COMPATIBILITY.md`.

---

## 🎨 Phase 5A: Metadata & Artwork Pipeline (COMPLETED ✅)
- [x] **Core Principle**: *"Metadata enriches the Game. It never substitutes its technical identity."*
- [x] **Database Schema Migration 013 (`013_metadata_pipeline`)**:
  - `game_metadata`: canonical enriched metadata, description, release date, developer, publisher, genres, tags, scores, and `user_override_flags`.
  - `game_metadata_sources`: multi-provider candidate history, source confidence, status tracking (`MATCHED`, `REVIEW_REQUIRED`, `USER_CONFIRMED`, `USER_REJECTED`), and review queue.
  - `game_artwork`: multi-type artwork assets (`COVER_FRONT`, `COVER_BACK`, `BANNER`, `BACKGROUND`, `SCREENSHOT`, `LOGO`), primary flag auto-switching, and `is_user_custom`.
  - `metadata_jobs`: background scraping priority queue (`USER_REQUESTED` > `NORMAL` > `BACKGROUND`) with retry tracking.
- [x] **Typed Repositories**:
  - `GameMetadataRepository`: CRUD operations and JSON serialization for `user_override_flags`.
  - `GameMetadataSourcesRepository`: Provenance tracking, unique compound constraint `(game_id, provider_id)`, and `getReviewQueue()`.
  - `GameArtworkRepository`: Asset lifecycle management and atomic primary switching.
  - `MetadataJobsRepository`: Priority ordering and crash recovery via `recoverStaleJobs()`.
- [x] **Identification & Tag Normalization (`GameIdentificationService`)**:
  - Dumps tag sanitization, multi-track `.bin` stripping, and clean title extraction.
  - Semantic region normalization (`(USA)` -> `NA`, `(Europe)` -> `EU`, `(Japan)` -> `JP`, etc.).
  - Multi-disc sequence detection (`Disc 1`, `Disc 2`).
  - Serial code extraction from filename brackets (`[SLUS-00594]`, `[SCUS-94163]`, `NTR-`, `ULUS`, etc.).
- [x] **Canonical Platform Mapping (`MetadataPlatformMapper`)**:
  - Platform alias normalization and ScreenScraper numeric system ID resolution.
- [x] **Deterministic Candidate Scoring Engine (`MetadataCandidateScorer`)**:
  - Normalized Levenshtein title similarity (base up to 60).
  - Platform compatibility bonus (+20) and cross-platform mismatch penalty (-40).
  - Region (+5) and release year (+10) alignment signals.
  - Hardware serial code match (+35).
  - Binary file hash (CRC32, MD5, SHA1) instant 100 score.
- [x] **Match Resolution & Review Queue Routing (`MetadataMatchResolver`)**:
  - Confidence classification: `EXACT` (>= 95), `HIGH` (>= 80), `MEDIUM` (>= 60), `LOW` (< 60).
  - Ambiguity detection: competitor score delta < 5 triggers `AMBIGUOUS` confidence and routes to `REVIEW_REQUIRED`.
  - Safe auto-acceptance: clear winners (>= 10 point margin and score >= 80) accepted without user intervention.
- [x] **Metadata Request & Negative Caching (`MetadataRequestCache`)**:
  - In-memory query caching and 24-hour negative caching for failed queries to prevent API hammering.
- [x] **Decoupled Provider Registry (`MetadataProviderRegistry`)**:
  - Dynamic discovery via `IntegrationManager.getConnectionsWithCapability('METADATA_SEARCH')`.
  - Seamless support for ScreenScraper API v2, IGDB v4, and Steam Storefront Scraper.
- [x] **Safe Merge Service (`MetadataMergeService`)**:
  - **Inviolable User Overrides**: remote enrichment NEVER overwrites fields tracked in `user_override_flags`.
  - Field provenance and atomic mirroring to `games` table for backward compatibility.
- [x] **Hardened Artwork Cache (`ArtworkCacheManager`)**:
  - **SSRF Defense**: blocks loopback, private IPv4 ranges (10.x, 172.16.x, 192.168.x), and cloud metadata endpoints.
  - **MIME Validation**: strictly validates `image/*` Content-Type headers.
  - **Size Boundaries**: enforces 15 MB limit for covers and 25 MB limit for banners/backgrounds.
  - **Alpha Channel Preservation**: retains PNG and WebP transparency for title logos.
  - **Custom Artwork**: `saveCustomArtwork()` handles user-uploaded manual covers (`isUserCustom: true`).
  - Native Electron protocol `local-artwork://` for secure offline rendering.
- [x] **Background Job Execution (`MetadataJobManager`)**:
  - Priority scheduling, crash recovery on startup, and batch queueing across the entire library.
- [x] **Desktop IPC & UI Layer**:
  - Typed IPC channels and handlers for metadata search, review queue, custom covers, and job status.
  - `MetadataReviewModal`: side-by-side candidate comparison and resolution.
  - `GameDetailsModal`: "Refresh Metadata" and "Custom Cover" buttons with live reactive updates.
  - `SettingsView`: "Metadata & Artwork" tab with provider preferences, review queue badge, cache analytics, and cache clear.
- [x] **100% Automated Test Coverage**: 60/60 Phase 5A test scenarios passing (`npm run test:phase5a`) with zero regressions across Phase 4A and Phase 4C test suites.
- [x] **Documentation**: `docs/METADATA_PIPELINE.md`, `docs/ARTWORK_PIPELINE.md`, and `docs/METADATA_MATCHING.md`.

---

## 🌐 Phase 6: Multi-Provider Expansion
- [ ] `OneDriveProvider implements StorageProvider` (Microsoft Graph API).
- [ ] `DropboxProvider implements StorageProvider` (Dropbox API v2).
- [ ] `NasProvider implements StorageProvider` (SMB / WebDAV / SFTP).
- [ ] `LocalFolderProvider implements StorageProvider` (Offline hard drives and SSDs).
- [ ] Multi-account aggregation (e.g. combining multiple Google Drive and OneDrive accounts into a single library).

---

## 💾 Phase 7: Intelligent Cache Eviction & Cloud Save Sync
- [ ] LRU (Least Recently Used) automatic cache eviction when disk threshold is reached.
- [ ] Cloud savegame backup & sync between remote storage and local save directories.
- [ ] Game uninstall / evict action (frees local disk space while retaining game in `CLOUD` state).
