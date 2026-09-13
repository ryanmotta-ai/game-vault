import fs from 'node:fs';
import path from 'node:path';
import { GamePlatform, ManifestFileEntry, ManifestFileRole } from '../core/types';

export interface PlayableDetectionResult {
  primaryFilePath: string;
  primaryRelativePath: string;
  platform: GamePlatform;
  installRequired: boolean;
  requiredFiles: ManifestFileEntry[];
  optionalFiles: ManifestFileEntry[];
  isMultiDisc: boolean;
  discCount?: number;
}

// Ordered priority list of extensions per platform
export const PLATFORM_PLAYABLE_EXTENSIONS: Record<string, string[]> = {
  'PlayStation': ['.cue', '.chd', '.pbp'],
  'PlayStation 2': ['.iso', '.chd', '.cso'],
  'PlayStation 3': ['.iso', '.pkg', '.eboot.bin', '.bin'],
  'PSP': ['.iso', '.cso'],
  'GameCube': ['.rvz', '.iso', '.gcz', '.gcm'],
  'Wii': ['.rvz', '.wbfs', '.iso'],
  'Dreamcast': ['.gdi', '.cdi', '.chd'],
  'Nintendo DS': ['.nds'],
  'Nintendo 3DS': ['.3ds', '.cci'],
  'Nintendo 64': ['.z64', '.n64', '.v64'],
  'Game Boy Advance': ['.gba'],
  'SNES': ['.sfc', '.smc'],
  'NES': ['.nes'],
  'PC': ['.exe']
};

// Known installer/setup executable names for PC games
const PC_INSTALLER_NAMES = new Set([
  'setup.exe',
  'install.exe',
  'installer.exe',
  'autorun.exe'
]);

// Ignored helper / utility executables for PC games
const PC_IGNORED_NAMES = new Set([
  'unins000.exe',
  'uninstall.exe',
  'dxsetup.exe',
  'vcredist.exe',
  'vcredist_x86.exe',
  'vcredist_x64.exe',
  'crash_handler.exe',
  'crash_reporter.exe',
  'crashreporter.exe',
  'unitycrashhandler32.exe',
  'unitycrashhandler64.exe',
  'redist.exe'
]);

export class PlayableFileDetector {
  /**
   * Scans a target directory and identifies primary playable file, required sets, and auxiliary files.
   */
  public detect(
    targetDir: string,
    expectedPlatform: GamePlatform,
    gameTitle?: string
  ): PlayableDetectionResult {
    const allFiles = this.collectAllFiles(targetDir);
    if (allFiles.length === 0) {
      throw new Error(`No files found in preparation directory: ${targetDir}`);
    }

    const platformPriority = PLATFORM_PLAYABLE_EXTENSIONS[expectedPlatform] || [];

    // 1. Identify PC platform specifically
    if (expectedPlatform === 'PC') {
      return this.detectPC(targetDir, allFiles, gameTitle);
    }

    // 2. Identify Console/Emulator platform
    let primaryCandidate: { fullPath: string; relPath: string; size: number; priority: number } | null = null;

    for (const file of allFiles) {
      const ext = path.extname(file.relPath).toLowerCase();
      const priorityIndex = platformPriority.indexOf(ext);

      if (priorityIndex !== -1) {
        if (!primaryCandidate || priorityIndex < primaryCandidate.priority) {
          primaryCandidate = {
            fullPath: file.fullPath,
            relPath: file.relPath,
            size: file.size,
            priority: priorityIndex
          };
        } else if (priorityIndex === primaryCandidate.priority) {
          // In case of equal extension priority (e.g. multi-disc or cue), prioritize Disc 1 or shorter name
          if (this.isDiscOne(file.relPath) && !this.isDiscOne(primaryCandidate.relPath)) {
            primaryCandidate = {
              fullPath: file.fullPath,
              relPath: file.relPath,
              size: file.size,
              priority: priorityIndex
            };
          }
        }
      }
    }

    // Fallback: If no expected platform extension found, check general rom extensions
    if (!primaryCandidate) {
      for (const file of allFiles) {
        const ext = path.extname(file.relPath).toLowerCase();
        for (const [_, exts] of Object.entries(PLATFORM_PLAYABLE_EXTENSIONS)) {
          if (exts.includes(ext)) {
            primaryCandidate = {
              fullPath: file.fullPath,
              relPath: file.relPath,
              size: file.size,
              priority: 999
            };
            break;
          }
        }
        if (primaryCandidate) break;
      }
    }

    // Last resort fallback: largest file
    if (!primaryCandidate) {
      const sortedBySize = [...allFiles].sort((a, b) => b.size - a.size);
      const largest = sortedBySize[0];
      primaryCandidate = {
        fullPath: largest.fullPath,
        relPath: largest.relPath,
        size: largest.size,
        priority: 9999
      };
    }

    // 3. Classify all files into required vs optional
    const requiredFiles: ManifestFileEntry[] = [];
    const optionalFiles: ManifestFileEntry[] = [];
    let isMultiDisc = false;
    let discCount = 1;

    const primaryExt = path.extname(primaryCandidate.relPath).toLowerCase();
    const isCueBin = primaryExt === '.cue';
    const isGdi = primaryExt === '.gdi';

    for (const file of allFiles) {
      const isPrimary = file.fullPath === primaryCandidate.fullPath;
      const ext = path.extname(file.relPath).toLowerCase();

      let role: ManifestFileRole = 'AUXILIARY';
      let isRequired = false;

      if (isPrimary) {
        role = 'PRIMARY';
        isRequired = true;
      } else if (isCueBin && ext === '.bin') {
        // CUE + BIN track: required!
        role = 'TRACK';
        isRequired = true;
      } else if (isGdi && (ext === '.bin' || ext === '.raw')) {
        // Dreamcast GDI track: required!
        role = 'TRACK';
        isRequired = true;
      } else if (this.isDiscFile(file.relPath, primaryExt)) {
        // Multi-disc companion: required!
        role = 'PRIMARY';
        isRequired = true;
        isMultiDisc = true;
        discCount++;
      } else if (['.txt', '.nfo', '.url', '.diz', '.jpg', '.png'].includes(ext)) {
        role = 'DOCUMENT';
        isRequired = false;
      } else {
        // Other support files in directory
        role = 'AUXILIARY';
        isRequired = true;
      }

      const entry: ManifestFileEntry = {
        path: file.fullPath,
        relativePath: file.relPath,
        sizeBytes: file.size,
        role
      };

      if (isRequired) {
        requiredFiles.push(entry);
      } else {
        optionalFiles.push(entry);
      }
    }

    return {
      primaryFilePath: primaryCandidate.fullPath,
      primaryRelativePath: primaryCandidate.relPath,
      platform: expectedPlatform,
      installRequired: false,
      requiredFiles,
      optionalFiles,
      isMultiDisc,
      discCount: isMultiDisc ? discCount : undefined
    };
  }

  /**
   * Specialized PC executable detection handling installers vs portable game binaries.
   */
  private detectPC(
    _targetDir: string,
    allFiles: Array<{ fullPath: string; relPath: string; size: number }>,
    gameTitle?: string
  ): PlayableDetectionResult {
    const exeFiles = allFiles.filter((f) => path.extname(f.relPath).toLowerCase() === '.exe');

    if (exeFiles.length === 0) {
      // Fallback: largest file in archive
      const largest = [...allFiles].sort((a, b) => b.size - a.size)[0];
      return {
        primaryFilePath: largest.fullPath,
        primaryRelativePath: largest.relPath,
        platform: 'PC',
        installRequired: false,
        requiredFiles: allFiles.map((f) => ({
          path: f.fullPath,
          relativePath: f.relPath,
          sizeBytes: f.size,
          role: f.fullPath === largest.fullPath ? 'PRIMARY' : 'AUXILIARY'
        })),
        optionalFiles: [],
        isMultiDisc: false
      };
    }

    // Check for explicit installer (setup.exe, install.exe)
    const installer = exeFiles.find((f) => {
      const base = path.basename(f.relPath).toLowerCase();
      return PC_INSTALLER_NAMES.has(base);
    });

    let primaryExe = installer;
    let installRequired = false;

    if (installer) {
      installRequired = true;
      primaryExe = installer;
    } else {
      // Portable PC Game: filter out uninstaller/crash handlers
      const candidates = exeFiles.filter((f) => {
        const base = path.basename(f.relPath).toLowerCase();
        return (
          !PC_IGNORED_NAMES.has(base) &&
          !base.startsWith('unins') &&
          !base.includes('crash') &&
          !base.includes('reporter')
        );
      });

      if (candidates.length > 0) {
        // Try title match
        if (gameTitle) {
          const normTitle = gameTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matched = candidates.find((c) => {
            const normBase = path.basename(c.relPath, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '');
            return normBase.includes(normTitle) || normTitle.includes(normBase);
          });
          primaryExe = matched || candidates[0];
        } else {
          primaryExe = candidates[0];
        }
      } else {
        primaryExe = exeFiles[0];
      }
    }

    const requiredFiles: ManifestFileEntry[] = [];
    const optionalFiles: ManifestFileEntry[] = [];

    for (const file of allFiles) {
      const isPrimary = file.fullPath === primaryExe.fullPath;
      const ext = path.extname(file.relPath).toLowerCase();
      const isDoc = ['.txt', '.nfo', '.url', '.diz'].includes(ext);

      const entry: ManifestFileEntry = {
        path: file.fullPath,
        relativePath: file.relPath,
        sizeBytes: file.size,
        role: isPrimary ? (installRequired ? 'INSTALLER' : 'PRIMARY') : isDoc ? 'DOCUMENT' : 'AUXILIARY'
      };

      if (isDoc) {
        optionalFiles.push(entry);
      } else {
        requiredFiles.push(entry);
      }
    }

    return {
      primaryFilePath: primaryExe.fullPath,
      primaryRelativePath: primaryExe.relPath,
      platform: 'PC',
      installRequired,
      requiredFiles,
      optionalFiles,
      isMultiDisc: false
    };
  }

  private collectAllFiles(dir: string, baseDir = dir): Array<{ fullPath: string; relPath: string; size: number }> {
    const results: Array<{ fullPath: string; relPath: string; size: number }> = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectAllFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push({
          fullPath,
          relPath,
          size: stat.size
        });
      }
    }
    return results;
  }

  private isDiscOne(relPath: string): boolean {
    const lower = relPath.toLowerCase();
    return (
      lower.includes('disc 1') ||
      lower.includes('disc1') ||
      lower.includes('cd 1') ||
      lower.includes('cd1') ||
      lower.includes('(disc 1)') ||
      lower.includes('(cd 1)')
    );
  }

  private isDiscFile(relPath: string, primaryExt: string): boolean {
    const ext = path.extname(relPath).toLowerCase();
    if (ext !== primaryExt) return false;
    const lower = relPath.toLowerCase();
    return (
      lower.includes('disc') ||
      lower.includes('cd') ||
      lower.includes('part')
    );
  }
}

export const defaultPlayableFileDetector = new PlayableFileDetector();
