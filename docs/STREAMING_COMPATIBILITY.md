# Game Vault — Streaming & Instant Play Compatibility Matrix (Phase 4C) 📋

## 1. Executive Summary & Architectural Honesty

Game Vault's design philosophy prioritizes **honesty, stability, and zero kernel tampering**:
1. **User-Space Exclusivity:** We deliberately reject kernel-level virtual file system drivers (such as WinFsp, Dokan, or proprietary kernel filter drivers) on Windows. These drivers introduce system stability risks (Blue Screen of Death), trigger false positives in antivirus engines, and require administrative installation permissions.
2. **Win32 API Realities:** Standalone desktop emulators on Windows (e.g. PCSX2, Dolphin, DuckStation, RPCS3) interact with game files via Win32 file APIs (`CreateFileW`, `ReadFile`, memory mapping via `CreateFileMappingW`). They expect an actual file path on an NTFS/exFAT filesystem and do not accept `http://` URLs as command-line ROM targets.
3. **The Game Vault Solution:**
   - **Instant Hydration (`INSTANT_HYDRATION`):** For games $\le 128\text{ MB}$ (covering 95%+ of classic retro libraries), Game Vault fetches the ROM directly to cache in $< 2$ seconds. Emulators receive real local file paths without any user friction.
   - **Progressive Streaming (`PROGRESSIVE_PLAY`):** For medium-sized single-file discs (PS1 `.chd`), Game Vault operates an ephemeral `127.0.0.1` HTTP Range server with sparse 4 MB block caching for compatible frontends/emulators that support HTTP streams.
   - **Local Required (`LOCAL_REQUIRED`):** For heavy DVD/BD platforms (PS2, GameCube, Wii), full download and preparation is enforced.

---

## 2. Platform Compatibility Matrix

| Platform | Typical Size | Recommended Strategy | Emulators Supported | Experience |
| :--- | :--- | :--- | :--- | :--- |
| **NES / Famicom** | 128 KB – 1 MB | `INSTANT_HYDRATION` | Mesen, Nestopia, RetroArch | Instant ($\le 1\text{s}$), fully local |
| **SNES / Super Famicom** | 1 MB – 6 MB | `INSTANT_HYDRATION` | Snes9x, bsnes, RetroArch | Instant ($\le 1.5\text{s}$), fully local |
| **Game Boy / GBC** | 256 KB – 4 MB | `INSTANT_HYDRATION` | mGBA, SameBoy, RetroArch | Instant ($\le 1\text{s}$), fully local |
| **Game Boy Advance** | 4 MB – 32 MB | `INSTANT_HYDRATION` | mGBA, VBA-M, RetroArch | Instant ($\le 2\text{s}$), fully local |
| **Sega Genesis / Mega Drive** | 512 KB – 4 MB | `INSTANT_HYDRATION` | Genesis Plus GX, Kega Fusion | Instant ($\le 1\text{s}$), fully local |
| **Nintendo 64** | 8 MB – 64 MB | `INSTANT_HYDRATION` | Simple64, Project64, RetroArch | Instant ($\le 2\text{s}$), fully local |
| **Nintendo DS** | 16 MB – 128 MB | `INSTANT_HYDRATION` | melonDS, DeSmuME | Instant ($\le 2.5\text{s}$), fully local |
| **PlayStation (PS1)** | 128 MB – 650 MB | `PROGRESSIVE_PLAY` / `INSTANT_HYDRATION` | DuckStation, Beetle PSX, RetroArch | Progressive streaming via 4 MB block cache for `.chd` discs on Good network |
| **PlayStation 2 (PS2)** | 1.5 GB – 8.5 GB | `LOCAL_REQUIRED` | PCSX2 | Full download and preparation required |
| **Nintendo GameCube** | 1.35 GB | `LOCAL_REQUIRED` | Dolphin | Full download and preparation required |
| **Nintendo Wii** | 4.3 GB – 8.5 GB | `LOCAL_REQUIRED` | Dolphin | Full download and preparation required |
| **PC Games (Native)** | Varies | `LOCAL_REQUIRED` | Windows Executables | Full installation required |

---

## 3. Why PS2, GameCube, and Wii Require Full Local Preparation

### 3.1 Random Access & DVD Layer Seek Timeouts
Modern disc-based emulators like PCSX2 and Dolphin emulate DVD drives with strict timing models. Games such as *Gran Turismo 4*, *God of War II*, or *Metroid Prime* perform scattered random-access reads across several gigabytes of data simultaneously (streaming audio, loading textures, preloading level chunks). Over high-latency cloud connections, scattered block seeks cause read stalls exceeding 500ms, triggering internal watchdog crashes inside emulated BIOS and audio threads.

### 3.2 Dual-Layer & Multi-File Complexity
DVD games frequently use multi-file archives or dual-layer images ($> 4\text{ GB}$). A reliable user experience demands complete extraction, hash validation, and local disc image integrity before launching.

---

## 4. Emulator Streaming Integration Modes

1. **Native Local File Path (All Emulators):**
   - Game Vault hydrates or prepares the ROM in `.gamevault/cache/games/<gameId>/<rom>`.
   - Passes standard Windows absolute path `C:\Users\...\rom.iso` to emulator executable with `shell: false`.
2. **Localhost HTTP Loopback URL (Compatible Frontends / RetroArch):**
   - Game Vault spins up `LocalhostStreamServer` on `http://127.0.0.1:<PORT>/session/<TOKEN>/game.chd`.
   - Emulator connects over HTTP Range requests (`206 Partial Content`).
   - Sparse 4 MB blocks are pulled on-demand and cached persistently on disk.
