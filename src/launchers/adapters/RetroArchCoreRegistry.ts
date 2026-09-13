import fs from 'node:fs';
import path from 'node:path';
import { GamePlatform } from '../../core/types';

export interface CoreResolutionResult {
  corePath: string;
  coreName: string;
}

export class RetroArchCoreRegistry {
  private static readonly PLATFORM_CORE_MAP: Partial<Record<GamePlatform, string[]>> = {
    'NES': ['mesen_libretro', 'fceumm_libretro', 'nestopia_libretro'],
    'SNES': ['snes9x_libretro', 'bsnes_libretro'],
    'Game Boy': ['gambatte_libretro', 'mgba_libretro'],
    'Game Boy Color': ['gambatte_libretro', 'mgba_libretro'],
    'Game Boy Advance': ['mgba_libretro', 'vba_next_libretro'],
    'Nintendo 64': ['mupen64plus_next_libretro', 'parallel_n64_libretro']
  };

  public static getCandidateCoreBases(platform: GamePlatform): string[] {
    return this.PLATFORM_CORE_MAP[platform] || [];
  }

  public static resolveCore(platform: GamePlatform, coresDir: string): CoreResolutionResult | null {
    if (!coresDir || !fs.existsSync(coresDir)) {
      return null;
    }

    const candidateBases = this.getCandidateCoreBases(platform);
    if (candidateBases.length === 0) {
      return null;
    }

    const ext = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so';

    for (const base of candidateBases) {
      const fileName = `${base}${ext}`;
      const fullPath = path.join(coresDir, fileName);
      if (fs.existsSync(fullPath)) {
        return {
          corePath: fullPath,
          coreName: fileName
        };
      }
    }

    // Fallback: search directory for any case-insensitive match
    try {
      const files = fs.readdirSync(coresDir);
      for (const base of candidateBases) {
        const found = files.find((f) => f.toLowerCase().startsWith(base.toLowerCase()));
        if (found) {
          return {
            corePath: path.join(coresDir, found),
            coreName: found
          };
        }
      }
    } catch {
      // Ignore read errors
    }

    return null;
  }
}
