# Game Vault — Game Preparation, Extraction & Playable Detection (Phase 3C) 📦

## 1. Overview & Core Philosophy

> **"O usuário coleciona jogos, não arquivos."**
> 
> O usuário nunca deve precisar:
> - Extrair arquivos ZIP, 7Z ou RAR manualmente
> - Procurar um executável ou arquivo ISO dentro de pastas aninhadas
> - Mover ROMs ou escolher estrutura de diretórios
> - Limpar arquivos temporários após extração
> - Configurar manualmente pares CUE + BIN ou arquivos GDI

Phase 3C establishes the automated bridge between file downloads and executable games:
```text
  CLOUD
    ↓ [Download]
DOWNLOADING
    ↓ [Auto-Handoff when CACHED_LOCAL]
PREPARING (Extraction, Zip-Slip Defense, Executable Scoring, Manifest Generation)
    ↓ [Validation Passed]
  READY (Zero manual interaction required)
```

---

## 2. Architecture & Preparation Pipeline

```mermaid
flowchart TD
    subgraph Trigger [Event Trigger]
        DH["DownloadManager (All files CACHED_LOCAL)"]
        UI["UI Manual Re-prepare [ PREPARE ]"]
    end

    subgraph Service [GamePreparationService]
        GPS["prepare(gameId)"]
        PJRepo["preparation_jobs (Status: IN_PROGRESS)"]
        CheckType{"Archive or Raw Binary?"}
    end

    subgraph Extraction [Archive Extraction Engine]
        ZipExt["ZipExtractor (adm-zip)"]
        SevenExt["SevenZipExtractor (7za / node-7z)"]
        RarExt["RarExtractor (unrar fallback)"]
        PreFlight["Pre-flight Zip Slip Validation (validateEntryPath)"]
        Sandbox["Temporary Sandbox (<cacheDir>/prepare/<jobId>/)"]
    end

    subgraph Detection [Playable File Detector]
        Scanner["Scan files recursively"]
        Filter["Filter out Crash Reporters, Unins000, Config Tools"]
        Scorer["Platform Scorer (PS1, PS2, PSP, GC, Wii, DC, PC...)"]
        InstallerCheck{"Installer (setup.exe)?"}
    end

    subgraph Finalization [Atomic Move & Manifest Generation]
        Atomic["Atomic fs.rename(sandboxDir, gamesDir/<gameId>)"]
        Manifest["Generate manifest.json & SQLite game_manifests"]
        Retention{"keep_original_archives?"}
        DeleteArchive["Delete downloaded archive"]
        UpdateGame["games (state: READY, installed_path)"]
    end

    DH --> GPS
    UI --> GPS
    GPS --> PJRepo
    GPS --> CheckType

    CheckType -->|Archive (.zip, .7z, .rar)| PreFlight
    PreFlight -->|Zip Slip Detected| AbortError["Abort & Cleanup Sandbox"]
    PreFlight -->|Safe| Sandbox
    Sandbox --> ZipExt
    Sandbox --> SevenExt
    Sandbox --> RarExt
    CheckType -->|Raw Game File (.iso, .nds, etc.)| Atomic

    ZipExt --> Scanner
    SevenExt --> Scanner
    RarExt --> Scanner

    Scanner --> Filter
    Filter --> Scorer
    Scorer --> InstallerCheck
    InstallerCheck -->|Yes| SetInstall["installRequired = true"]
    InstallerCheck -->|No| SetPlayable["mainExecutable = target"]

    SetInstall --> Atomic
    SetPlayable --> Atomic
    Atomic --> Manifest
    Manifest --> Retention
    Retention -->|false| DeleteArchive
    Retention -->|true| UpdateGame
    DeleteArchive --> UpdateGame
    UpdateGame --> Done["State: READY"]
```

---

## 3. Archive Extraction Engine & Multi-Format Support

The preparation engine features a unified `ArchiveExtractorEngine` delegating to format-specific extractors based on file extension and magic headers:

1. **ZIP Files (`.zip`)**:
   - Processed via `ZipExtractor` using `adm-zip`.
   - Streaming in-memory entry inspection with synchronous extraction into the sandbox.
2. **7-Zip Files (`.7z`)**:
   - Processed via `SevenZipExtractor` utilizing `node-7z` and standalone `7za` binary (`7zip-bin`).
   - Supports LZMA/LZMA2 high-compression archives with real-time percentage progress parsing.
3. **RAR Files (`.rar`)**:
   - Processed via `RarExtractor` utilizing `unrar-promise` or 7za fallback.
   - Handles multi-part RAR volumes (`.part1.rar`, `.r00`) transparently.
4. **Raw ROM / ISO Pass-through**:
   - If the downloaded file is already a raw uncompressed playable format (e.g. `.iso`, `.nds`, `.chd`, `.gba`), extraction is skipped entirely.
   - The file is placed directly into `<cacheDir>/games/<gameId>/` and a manifest is generated immediately.

---

## 4. Pre-Flight Zip Slip Defense

A critical security requirement is preventing **Zip Slip** directory traversal attacks, where malicious archives contain entry filenames with path navigation sequences like `../../../../Windows/System32/calc.exe`.

### Defense Implementation (`validateEntryPath`)
Before any file from an archive is unpacked to disk:
1. Entry filenames are extracted and checked using strict normalization:
   ```typescript
   export function validateEntryPath(targetDir: string, entryName: string): string {
     // 1. Disallow null bytes or illegal characters
     if (entryName.includes('\0')) {
       throw new ZipSlipError(`Archive entry contains null byte: ${entryName}`);
     }
     
     // 2. Normalize path and resolve against target destination
     const normalizedEntry = path.normalize(entryName).replace(/^(\.\.[\/\\])+/, '');
     const resolvedPath = path.resolve(targetDir, normalizedEntry);
     
     // 3. Ensure resolved path begins strictly within targetDir
     const normalizedTarget = path.normalize(targetDir) + path.sep;
     if (!resolvedPath.startsWith(normalizedTarget) && resolvedPath !== path.normalize(targetDir)) {
       throw new ZipSlipError(`Zip slip attempt detected: "${entryName}" escapes destination "${targetDir}"`);
     }
     
     return resolvedPath;
   }
   ```
2. **Atomic Abort on Violation:**
   - If any single entry violates boundaries, extraction halts immediately.
   - The sandbox directory `<cacheDir>/prepare/<jobId>/` is deleted recursively.
   - The job is marked `FAILED` with error code `ZIP_SLIP_ATTEMPT`.
   - The target game directory is **never created or modified**.

---

## 5. Temporary Sandbox Lifecycle & Atomic Renaming

To guarantee that a partial extraction or interrupted operation never corrupts the game library:

1. **Dedicated Sandbox Directory:**
   - Every preparation job executes in an isolated sandbox: `<cacheDir>/prepare/<jobId>/`.
2. **All-or-Nothing Extraction:**
   - Archives are extracted entirely inside the sandbox.
   - Playable file detection and verification occur inside this sandbox.
3. **Atomic Finalization:**
   - Once all validations pass, the folder is moved using an atomic filesystem rename:
     ```typescript
     await fs.promises.rename(sandboxPath, destinationGamePath);
     ```
   - On Windows and Unix within the same volume/drive, `fs.rename` is instantaneous and atomic.
4. **Clean Failure Rollback:**
   - If anything fails during extraction or validation, `fs.promises.rm(sandboxPath, { recursive: true, force: true })` ensures zero residual junk on disk.

---

## 6. Playable File Detection & Heuristics Matrix

Games can contain complex multi-file layouts (CUE/BIN, GDI multi-track, documentation, crash reporters, redistributables). `PlayableFileDetector` inspects extracted contents and scores candidates:

### Platform Rules & File Scoring
| Platform | Primary Target Extensions | Priority / Scoring Rules |
| :--- | :--- | :--- |
| **PlayStation (PS1)** | `.cue`, `.chd`, `.pbp`, `.iso`, `.bin` | Prefers `.cue` over `.bin` (to preserve CD audio tracks); preserves accompanying `.bin` files. |
| **PlayStation 2 (PS2)** | `.iso`, `.chd`, `.cso`, `.bin`, `.cue` | Prefers `.iso` / `.chd` over raw BIN. |
| **PlayStation Portable** | `.iso`, `.cso`, `.chd`, `.pbp` | Supports single-file UMD dumps. |
| **Nintendo GameCube** | `.rvz`, `.iso`, `.gcm`, `.ciso` | Prefers modern compressed `.rvz`. |
| **Nintendo Wii** | `.rvz`, `.wbfs`, `.iso`, `.ciso` | Prefers `.rvz` and `.wbfs`. |
| **Sega Dreamcast** | `.gdi`, `.chd`, `.cdi`, `.cue` | Prefers `.gdi` or `.chd`; keeps all track files. |
| **Nintendo DS / 3DS** | `.nds`, `.3ds`, `.cia` | Direct ROM selection. |
| **Nintendo 64** | `.z64`, `.n64`, `.v64` | Prefers `.z64` (Big-Endian standard). |
| **Game Boy Advance** | `.gba` | Direct ROM selection. |
| **Super Nintendo / NES** | `.sfc`, `.smc`, `.nes` | Direct ROM selection. |
| **Windows PC** | `.exe`, `.bat`, `.cmd` | Advanced heuristic filtering (see below). |

### PC Heuristic Filtering
When inspecting PC games with multiple executables:
1. **Crash Reporters and Diagnostic Tools:** Filtered out automatically:
   `*crash*`, `*reporter*`, `*feedback*`, `*bugreport*`, `unitycrashhandler*.exe`, `unrealcef*.exe`.
2. **Installers vs. Launchers:**
   - Installers are detected via name: `setup.exe`, `install.exe`, `autorun.exe`, `installer.exe`.
   - If an installer is found, the manifest sets:
     ```json
     { "installRequired": true, "mainExecutable": "setup.exe" }
     ```
   - The UI displays an `[ INSTALL ]` action rather than `[ PLAY ]`.
3. **Uninstallers:**
   - Always ignored: `unins000.exe`, `uninstall.exe`, `uninst.exe`.
4. **Configuration Tools:**
   - Lower-priority scoring: `*config*.exe`, `*settings*.exe`, `*launcher*.exe` are deprioritized in favor of root game executables matching the game title.

### Multi-File Preservation (CUE+BIN, GDI, Multi-Disc)
- If a `.cue` or `.gdi` is identified as the main executable, all linked binary tracks (`.bin`, `.raw`, `.track*`) are retained in the directory and recorded under `secondaryFiles` in the manifest.
- Multi-disc games (e.g., `Final Fantasy VII (Disc 1).cue`, `Final Fantasy VII (Disc 2).cue`) are cataloged so future disc-swapping APIs can reference every disc.

---

## 7. Local Manifest Specification

Every successfully prepared game receives a `manifest.json` on disk and a matching record in the `game_manifests` SQLite table.

### `manifest.json` Structure
```json
{
  "manifestVersion": 1,
  "gameId": "g_ps1_mgs1",
  "platform": "ps1",
  "title": "Metal Gear Solid",
  "mainExecutable": "Metal Gear Solid (Disc 1).cue",
  "secondaryFiles": [
    "Metal Gear Solid (Disc 1).bin",
    "Metal Gear Solid (Disc 2).cue",
    "Metal Gear Solid (Disc 2).bin"
  ],
  "installRequired": false,
  "totalSizeBytes": 1468006400,
  "extractedAt": "2026-09-13T10:30:00.000Z",
  "verifiedAt": "2026-09-13T10:30:15.000Z",
  "fileHashes": {
    "Metal Gear Solid (Disc 1).cue": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "Metal Gear Solid (Disc 1).bin": "sha256:d57f8976a203f1b40212f7fc8c65f7c32e92ec4f9b8c049615a1f11e9f1a049d"
  }
}
```

---

## 8. Integrity Verification: Cheap vs. Deep

Game Vault supports two verification levels to ensure games remain launchable over time without unwarranted CPU overhead:

1. **Cheap Verification (`verifyCheap`)**:
   - **Cost:** Sub-millisecond filesystem stat.
   - Checks that `mainExecutable` and all `secondaryFiles` exist on disk.
   - Verifies that file sizes match the manifest records.
   - Executed during regular UI rendering and app startup.
2. **Deep Verification (`verifyDeep`)**:
   - **Cost:** Streaming disk I/O with SHA-256 / MD5 calculation.
   - Streams every byte of each file through a crypto hash pipeline.
   - Compares the calculated hash against `fileHashes` in the manifest.
   - Triggered on-demand by user via `[ Verify Game Files ]` or after system crashes.

---

## 9. Archive Retention Policy

Controlled by the `keep_original_archives` configuration setting:
- **Default (`keep_original_archives: false`)**:
  - Once extraction, validation, and manifest generation complete successfully, the original downloaded archive in `<cacheDir>/downloads/` or `<cacheDir>/games/` is immediately unlinked.
  - Conserves local disk space, ensuring users never store both compressed and uncompressed files simultaneously.
- **Enabled (`keep_original_archives: true`)**:
  - The downloaded archive is preserved alongside the extracted game directory for backup or archiving purposes.

---

## 10. Crash Recovery & Startup Healing

If the system crashes, reboots, or loses power while extracting a 10 GB game:
1. On application launch, `GamePreparationService.recoverStalePreparationJobs()` executes:
   ```typescript
   public async recoverStalePreparationJobs(): Promise<void> {
     const staleJobs = this.prepRepo.getByStatus('IN_PROGRESS');
     for (const job of staleJobs) {
       this.prepRepo.updateStatus(job.id, 'FAILED', 'INTERRUPTED_BY_APP_EXIT');
       const sandboxPath = path.join(this.cacheDir, 'prepare', job.id);
       await fs.promises.rm(sandboxPath, { recursive: true, force: true }).catch(() => {});
     }
   }
   ```
2. Stale sandboxes are deleted to free storage.
3. The game status is cleanly recalculated by `GameAvailabilityService`. If the archive remains intact, the user can restart preparation with a single click.
