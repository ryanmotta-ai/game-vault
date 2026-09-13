# GAME VAULT 🎮

> Desktop Game Launcher transforming user personal cloud storage into a unified, console-like game library.

Game Vault allows users to connect their personal cloud storage (starting with Google Drive, followed by OneDrive, Dropbox, NAS, and local directories) and view their collection in a sleek, Steam/console-like interface. Games transition smoothly between remote cloud availability, on-demand local caching, and instant offline play.

The application is built completely **without any dependency on `rclone`**, relying on native modular storage provider abstractions and secure Node/Electron APIs.

---

## ⚡ Tech Stack

- **Shell & Desktop**: [Electron 34](https://www.electronjs.org/) (Strict Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP enforced)
- **UI & Components**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler & Tooling**: [Vite 6](https://vitejs.dev/) (Renderer) + [esbuild](https://esbuild.github.io/) (Main & Preload)
- **Local Database**: [SQLite](https://www.sqlite.org/) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (WAL mode + Foreign Keys enabled + Versioned Migrations)
- **Authentication & Security**: Native Google OAuth 2.0 with **PKCE (S256)** + Local Loopback Server ([RFC 8252](https://tools.ietf.org/html/rfc8252)) + Windows DPAPI via Electron `safeStorage`
- **Design System**: Steam / Modern Console Dark UI (`#0a0d14` palette, responsive card grid, status badges)

---

## 📁 Directory Architecture

The codebase enforces strict separation of concerns across dedicated domain modules:

```
src/
├── desktop/         # Electron Main process, window lifecycle, preload, secure IPC & security policies
├── ui/              # React Renderer application (Header, Sidebar, Views, Components & Styles)
├── core/            # Domain models, structured logger, typed errors, config manager, CredentialStore (DPAPI)
├── storage/         # StorageManager (multi-account) & CacheManager (disk usage, quota aggregation)
├── providers/       # StorageProvider interface, ProviderFactory, and GoogleDriveProvider (OAuth 2.0 PKCE)
├── database/        # SQLite connection, MigrationRunner, versioned DDL, and typed repositories
<<<<<<< Updated upstream
├── downloads/       # DownloadManager lifecycle contract and queue data structures
=======
├── downloads/       # DownloadManager, DownloadScheduler, DownloadWorker, and queue controllers
├── preparation/     # GamePreparationService, ArchiveExtractorEngine (.zip, .7z, .rar), PlayableFileDetector, LocalManifestService
├── streaming/       # RangeReader, BlockCache (4 MB chunks), PrefetchCoordinator, NetworkCapabilityEstimator, LocalhostStreamServer, InstantHydrationService
>>>>>>> Stashed changes
├── launchers/       # Native PC game execution service contracts
├── emulators/       # Emulator mapping and runner service contracts
└── metadata/        # Metadata enrichment and scraper service contracts
```

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v20+ (tested on Node v24)
- npm v10+

### Installation & Setup
```bash
# Clone or navigate to the project directory
cd game-vault

# Install dependencies (automatically runs postinstall rebuild for Electron SQLite)
npm install

# Setup Google Cloud OAuth Credentials (see docs/GOOGLE_DRIVE_SETUP.md)
cp .env.example .env
# Edit .env and paste your GAMEVAULT_GOOGLE_CLIENT_ID and GAMEVAULT_GOOGLE_CLIENT_SECRET
```

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts Vite dev server + compiles desktop & launches Electron |
| `npm run build` | Builds desktop (`scripts/build-desktop.mjs`) and renderer (`vite build`) |
| `npm run start` | Runs the compiled production application with Electron |
| `npm run typecheck` | Runs strict TypeScript verification across all files (`tsc --noEmit`) |
| `npm run lint` | Runs ESLint 9 Flat Config static analysis |
| `npm test` | Runs the complete test suite (Phase 2A database/auth + Phase 2B catalog discovery) |
| `npm run test:db` | Runs Phase 2A migration, security, multi-account, and repository tests |
| `npm run test:phase2b` | Runs all 25 automated scenarios for Phase 2B cloud scanning & catalog ingestion |
<<<<<<< Updated upstream
=======
| `npm run test:phase2c` | Runs all 25 automated scenarios + E2E integration test for Phase 2C sync correctness |
| `npm run test:phase3a` | Runs all 22 automated scenarios for Phase 3A Reliable Download Engine V1 |
| `npm run test:phase3b` | Runs all 42 automated scenarios for Phase 3B Resumable Downloads & Multi-Download Control |
| `npm run test:phase3c` | Runs all 35 automated scenarios for Phase 3C Install Preparation, Extraction & Smart Cache |
| `npm run test:phase4a` | Runs all 40 automated scenarios for Phase 4A Launcher Engine V1 & Emulator Integration |
| `npm run test:phase4c` | Runs all 41 automated scenarios for Phase 4C Instant Play, Progressive Streaming & Range Engine |
| `npm run test:integrations` | Runs all 12 automated scenarios for Platform Integration Foundation & ScreenScraper |
| `npm run test:phase5` | Runs all 10 automated scenarios for Phase 5 Automated Metadata Scraping & Artwork Enrichment |

---

## 🎨 Automated Metadata Scraping & Artwork Enrichment (Phase 5)

See [docs/METADATA_AND_ARTWORK.md](docs/METADATA_AND_ARTWORK.md) for comprehensive documentation.

- **Multi-Provider Scraping Chain**: Priority cascade querying ScreenScraper API v2 → Twitch IGDB v4 → Steam Storefront (public search and app details, zero login required) → local heuristics.
- **Intelligent Title Normalizer (`titleSanitizer.ts`)**: Strips ROM preservation tags (`(USA)`, `(Rev 1)`, `[!], [MULTI5]`), disc/track numbers, and archive extensions to ensure high match accuracy.
- **Offline-First Local Disk Artwork Cache (`ArtworkCacheManager.ts`)**: Automatically downloads and stores covers, horizontal banners, and screenshot galleries in `<cacheDir>/artwork/<gameId>/`.
- **Custom Scheme (`local-artwork://`)**: Secure, CSP-compliant Electron custom protocol for zero-latency offline rendering.
- **Enriched Game Details Modal & Cards**: Full synopsis, release year, developer, publisher, interactive genre pills, community ratings (`★ 8.8 / 10`), screenshot thumbnail carousel with viewer, and a live `[ 🔍 Refresh Metadata ]` action button.

---

## 🔌 Connected Services & Integration Hub (Parallel Track)

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) and [docs/CONNECTED_SERVICES.md](docs/CONNECTED_SERVICES.md) for comprehensive documentation.

- **Universal Integration Layer**: Centralized `IntegrationManager` and `IntegrationRegistry` separating connection lifecycle and authentication from domain providers.
- **Hardware-Backed Secret Protection**: Passwords, tokens, and API keys are stored via Electron `safeStorage` (Windows DPAPI / macOS Keychain) and never stored in plain-text SQLite or sent to renderer.
- **ScreenScraper Official API v2**: Official integration with `screenscraper.fr` supporting user credentials, rate limit quota tracking, latency diagnostics, and rich artwork metadata.
- **Non-Destructive Storage Reconciliation**: Existing Google Drive connections in `storage_accounts` are seamlessly bridged to the Integration Hub without re-login.
- **Settings → Integrations UI**: Modern Connected Services hub in Settings with category filters, dynamic connect forms, and health indicators.

---

## 🕹 Launcher Engine V1 & Emulator Integration (Phase 4A)

See [docs/LAUNCHER_ENGINE.md](docs/LAUNCHER_ENGINE.md) and [docs/EMULATOR_INTEGRATION.md](docs/EMULATOR_INTEGRATION.md) for comprehensive documentation.

- **Full Lifecycle Completion**: Closing the entire loop from `CLOUD` → `DOWNLOADING` → `PREPARING` → `READY` → `PLAY`.
- **Zero Shell Injection Guarantee**: Every process is launched strictly using `child_process.spawn(executable, args[], { shell: false })`, ensuring arguments with spaces, unicode characters, or malicious syntax are never parsed by command shells (`cmd.exe` or `sh`).
- **Console Emulator Adapters**: Out-of-the-box adapters for PCSX2 (PS2), DuckStation (PS1), Dolphin (GameCube & Wii), PPSSPP (PSP), and RetroArch (NES, SNES, Game Boy, Game Boy Color, Game Boy Advance, Nintendo 64).
- **Dynamic Libretro Core Registry**: Maps platforms to preferred Libretro cores (`snes9x`, `mesen`, `gambatte`, `mgba`, `mupen64plus_next`) with fallback resolution across standard directories.
- **Native PC Games Launcher**: Detects and directly spawns portable Windows game executables (`.exe`) with working directory isolation.
- **Process & Playtime Monitoring**: Tracks active game sessions, calculates session durations, detects crashes (`crashed = 1`), and atomically updates `games.play_time_seconds` and `games.last_played_at`.
- **Duplicate Launch Prevention**: Enforces single-instance execution per game ID (`GameAlreadyRunningError`).
- **Graceful Shutdown**: Exiting Game Vault unrefs running game processes and cleanly closes session logs in SQLite without interrupting active gameplay.
- **Non-Intrusive Auto-Detection**: Discovers emulators in standard installation folders without performing whole-disk scans.
- **Portable & Custom Emulators**: Allows manual registration of custom or portable emulator executables via UI browse dialog.
- **Per-Game Launch Profiles**: Configures custom command arguments and fullscreen toggles per game (`launch_profiles`).
- **Pre-Launch Self-Healing**: Automatically reconciles missing ROMs back to `CLOUD` state upon attempted launch.

---

## 📦 Install Preparation, Extraction & Smart Cache (Phase 3C)

See [docs/GAME_PREPARATION.md](docs/GAME_PREPARATION.md) and [docs/CACHE_MANAGEMENT.md](docs/CACHE_MANAGEMENT.md) for comprehensive documentation.

- **Automated Preparation**: Transforms downloaded archives and raw files into immediately launchable games (`CLOUD` → `DOWNLOADING` → `PREPARING` → `READY`) without manual unzipping or ROM organization.
- **Universal Extraction Engine**: Native support for `.zip` (adm-zip), `.7z` (standalone 7za binary), and `.rar` (node-unrar-js WebAssembly).
- **Zip Slip Defense**: Strict pre-flight path validation (`validateEntryPath`) blocks path traversal, leading slashes, UNC paths, and drive letters before writing any byte to disk.
- **Sandbox Isolation & Atomic Finalization**: Extracts to temporary sandbox `<cacheDir>/prepare/<jobId>/` and atomically renames to `<cacheDir>/games/<gameId>/` on verified completion.
- **Playable File Detection**: Intelligent platform-specific detection for PS1, PS2, PSP, GameCube, Wii, Dreamcast, NDS, 3DS, N64, GBA, SNES, NES, and PC.
- **Multi-File Set Preservation**: Preserves CUE+BIN tracks, Dreamcast GDI tracks, and multi-disc sets intact.
- **PC Game Distinctions**: Identifies portable game executables while tagging installers (`setup.exe`) as `installRequired: true` without auto-executing unknown binaries.
- **Game Manifests (`manifest.json`)**: Tracks primary executable/ROM, file sizes, roles (`PRIMARY`, `TRACK`, `AUXILIARY`), and integrity status.
- **Smart Cache V2**: Categorized cache breakdown (`PARTIAL`, `TEMP`, `GAME`, `ARTWORK`), cache size limit (`cache_max_bytes`), LRU eviction ranking, game pinning (`pinned = 1`), and non-destructive `[ Remove Local Copy ]`.

---

## ⚡ Resumable Download Engine & Multi-Download Control (Phase 3B)

See [docs/DOWNLOAD_ENGINE.md](docs/DOWNLOAD_ENGINE.md) for comprehensive architectural documentation.

- **Principle**: *"The user collects games, not files."* User triggers download with one click; engine handles transfer, checksum validation, and status transitions to `READY`.
- **HTTP Range Resumption**: Seamlessly resumes partial transfers using standard `Range: bytes=X-` headers with strict 206 Partial Content validation and 416 completion handling.
- **Persistent Partial Files (`.part`)**: Partial files are never deleted on user pause, graceful shutdown, or application crash.
- **Concurrent Slot Scheduler**: Multi-download scheduler supporting 1 to 4 configurable concurrent download slots (default 2), with dynamic priority management ("Download Next").
- **Exponential Backoff with Jitter**: Robust retry loop with exponential backoff (1s, 2s, 4s, 8s, 16s + jitter) recovering from network drops and honoring HTTP 429 `Retry-After`.
- **Self-Healing Partials**: Automatically detects oversized or corrupt partial files and resets to byte 0 without user-facing crashes.
- **Remote Mutation Invalidation**: Verifies remote MD5 and modified timestamps prior to resuming to protect against cloud file updates.
- **Crash Recovery & Startup Healing**: Scans for interrupted downloads on launch, marks status `PAUSED` (`INTERRUPTED_BY_APP_EXIT`), preserves `.part` files, and allows immediate resumption.
- **Centralized Availability Service**: Aggregates `READY`, `DOWNLOADING`, and `CLOUD` state across single-file and multi-file titles (BIN/CUE, multi-disc).
- **Zero Token Leakage**: Guarantees zero OAuth access/refresh tokens appear in logs, IPC payloads, or UI states.

---

## 🛡 Sync Correctness & Real-World Consistency (Phase 2C)

See [docs/SYNC_CORRECTNESS.md](docs/SYNC_CORRECTNESS.md) for comprehensive architectural documentation.

- **Virtual Path Reconstruction**: Hierarchically resolves virtual folder paths for Google Drive Changes API events using in-memory LRU caching and SQLite ancestry lookup (`CloudPathResolver`).
- **Atomic Folder Rename & Move Cascades**: Atomic SQLite substring updates propagate directory renames and relocations across both `cloud_files` and `game_files` without re-scanning.
- **Initial Scan Race Prevention Protocol**: Anchors pre-scan `startPageToken`, stamps files with `last_seen_run_id`, conditionally reconciles unseen files only on successful scans, and drains in-flight changes before token advancement.
- **Resilient Token Lifecycle**: Change tokens advance strictly upon successful batch processing; HTTP 410 Gone / expired tokens trigger safe automatic full resync recovery.
- **Transactional Catalog Ingestion**: All candidate catalog writes are wrapped in atomic SQLite transactions, preventing orphaned records.
- **User History Protection**: Re-ingestions and cloud renames/moves preserve user playtime, last played timestamps, ratings, and custom metadata.
>>>>>>> Stashed changes

---

## 🎮 Cloud Inventory & Game Discovery Highlights (Phase 2B)

- **Principle**: *"The user collects games, not files."* File IDs, complex paths, and MIME types are abstracted away into clean game cards.
- **Queue-Based BFS Traversal**: Scans Google Drive directory hierarchies without recursion stack limits, supporting page sizes up to 1000 items.
- **Network Resilience**: Automatic retry with exponential backoff and jitter for `429 Too Many Requests`, `403 rateLimitExceeded`, and `5xx` server errors (`fetchWithRetry`).
- **Google Drive Changes API**: Delta synchronization tracks additions, modifications, renames, moves, and deletions incrementally.
- **Contextual Heuristic Classification**: Distinguishes exclusive ROMs (0.95–0.99 confidence), contextual ambiguous files (`.iso`, `.exe`, `.zip`), and ignored files (`.txt`, `.mp3`).
- **Multi-Track BIN/CUE Grouping**: Collapses multi-track disc images (e.g. 25 `.bin` tracks + 1 `.cue`) into a single catalog entry.
- **Collision-Proof Slugs**: Generates unique identifiers formatted as `${slugify(title)}-${slugify(platform)}`.
- **Non-Destructive Deletion**: Trashed cloud files mark records as `MISSING` without losing user play time, notes, or metadata.
- **Interactive UI Controls**: Per-account scan triggers, "Scan All Accounts", real-time progress bar with phase indicators, and cancellation support.

---

## 🛡 Security & Authentication Highlights

- **Zero Hardcoded Credentials**: No tokens, client IDs, or secrets committed in code.
- **Windows DPAPI Token Encryption**: OAuth access tokens and refresh tokens are encrypted at rest using OS-level DPAPI (`safeStorage`) with AES-256-GCM fallback. Tokens are never stored in SQLite and are never sent to the renderer process.
- **Strict Least-Privilege Scopes**: Only `drive.readonly` and basic user info (`userinfo.profile`, `userinfo.email`) are requested. The app can never delete or modify files in your cloud storage.
- **Native RFC 8252 Loopback Flow**: Uses PKCE (Proof Key for Code Exchange) with SHA-256 challenges on an ephemeral local loopback server (`127.0.0.1:<port>/oauth2callback`) opened directly in the system's default browser.
- **Multi-Account Storage Support**: Link multiple independent Google accounts simultaneously with individual disconnect/reconnect actions and unified storage quota aggregation.
- **Context Isolation & CSP**: Renderer never has direct Node.js access; communication occurs exclusively via typed IPC channels defined in `IPC_CHANNELS`.
- **Navigation Protection**: Intercepts external links to open safely in the user's OS browser via `shell.openExternal`.

---

## 📄 License

Proprietary — Built for Game Vault.
