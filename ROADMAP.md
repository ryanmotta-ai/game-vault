# GAME VAULT — Project Roadmap 🗺

This roadmap tracks the development lifecycle of Game Vault. Each phase builds upon the previous, keeping strict architectural separation and test-driven verification.

> [!NOTE]
> Currently Completed Phase: **Phase 1 (Foundation)**. Subsequent phases are documented for planning purposes and must not be implemented ahead of their scheduled milestone.

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

## 🔮 Phase 2: Google Drive Authentication & Cloud Scanning
- [ ] Implement OAuth2 loopback authentication flow (RFC 8252) for Google Drive in Electron Main.
- [ ] Secure OS Keychain credential persistence (Windows Credential Manager / DPAPI) — zero plaintext storage.
- [ ] Google Drive recursive folder scanner (`files.list` with mimeType filtering for ISO, ROM, EXE, ZIP, 7Z, RAR, NSP, PKG).
- [ ] Folder-to-Game heuristic indexing (identifying game names and platforms from folder hierarchy).
- [ ] Background sync worker updating SQLite catalog with delta changes.

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
