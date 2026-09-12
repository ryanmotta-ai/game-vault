# GAME VAULT — Project Roadmap 🗺

This roadmap tracks the development lifecycle of Game Vault. Each phase builds upon the previous, keeping strict architectural separation and test-driven verification.

> [!NOTE]
> Currently Completed: **Phase 1 (Foundation)** & **Phase 2A (Google Authentication & Multi-Account Storage Foundation)**. Subsequent phases are documented for planning purposes and must not be implemented ahead of their scheduled milestone.

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

## 🔮 Phase 2B: Cloud Game Scanning & Catalog Ingestion (UPCOMING ⏳)
- [ ] Google Drive recursive folder scanner (`files.list` with mimeType filtering for ISO, ROM, EXE, ZIP, 7Z, RAR, NSP, PKG).
- [ ] Folder-to-Game heuristic indexing (identifying game names and platforms from folder hierarchy).
- [ ] Background sync worker updating SQLite catalog with delta changes.
- [ ] Multi-account inventory aggregation (browsing games across all connected accounts unified in the library).

---

## ⚡ Phase 3: High-Performance Resumable Download Engine & Cache
- [ ] Multi-threaded / chunked HTTP download stream for Google Drive v3 API.
- [ ] Resumable downloads supporting pause, cancel, network drops, and app restarts.
- [ ] MD5/SHA256 checksum verification against Google Drive remote file hashes.
- [ ] Automatic archive extraction (ZIP, 7z, RAR) into game cache directory upon download completion.
- [ ] Real-time download progress broadcasting over IPC to renderer UI.

---

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

---

## 🎨 Phase 5: Automated Metadata Scraping & Artwork Enrichment
- [ ] IGDB API / Steam Storefront / TheGamesDB scraper integration.
- [ ] High-resolution box art, horizontal banners, screenshots, and logos fetcher.
- [ ] Local disk cache for downloaded game artwork to allow instant offline rendering.
- [ ] Game details modal with synopsis, developer, publisher, release year, genres, and community ratings.

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
