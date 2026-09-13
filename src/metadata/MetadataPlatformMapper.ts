import { GamePlatform } from '../core/types';
import { PLATFORM_DEFINITIONS } from '../catalog/PlatformRegistry';

// ScreenScraper System IDs for canonical retro and console systems
export const SCREENSCRAPER_SYSTEM_IDS: Record<string, number> = {
  'NES': 3, // Nintendo Entertainment System / Famicom
  'SNES': 4, // Super Nintendo / Super Famicom
  'Nintendo 64': 5, // Nintendo 64
  'GameCube': 6, // Nintendo GameCube
  'Wii': 7, // Nintendo Wii
  'Game Boy': 9, // Game Boy
  'Game Boy Color': 10, // Game Boy Color
  'Game Boy Advance': 12, // Game Boy Advance
  'Nintendo DS': 15, // Nintendo DS
  'Nintendo 3DS': 17, // Nintendo 3DS
  'Nintendo Switch': 225, // Nintendo Switch
  'PlayStation': 57, // Sony PlayStation 1
  'PlayStation 2': 58, // Sony PlayStation 2
  'PlayStation 3': 59, // Sony PlayStation 3
  'PSP': 61, // PlayStation Portable
  'Sega Genesis': 1, // Sega Megadrive / Genesis
  'Dreamcast': 23, // Sega Dreamcast
  'PC': 135 // PC / Windows
};

export class MetadataPlatformMapper {
  /**
   * Normalizes an external provider platform name, alias, or ID into Game Vault GamePlatform.
   */
  public static toGamePlatform(rawPlatform?: string | number): GamePlatform | undefined {
    if (rawPlatform === undefined || rawPlatform === null) return undefined;

    // 1. Check numeric system IDs (e.g. from ScreenScraper)
    if (typeof rawPlatform === 'number' || /^\d+$/.test(String(rawPlatform))) {
      const num = Number(rawPlatform);
      for (const [platform, sysId] of Object.entries(SCREENSCRAPER_SYSTEM_IDS)) {
        if (sysId === num) {
          return platform as GamePlatform;
        }
      }
    }

    const str = String(rawPlatform).trim().toLowerCase();
    if (!str) return undefined;

    // 2. Check exact matches against PlatformRegistry
    for (const [, def] of Object.entries(PLATFORM_DEFINITIONS)) {
      if (def.displayName.toLowerCase() === str || def.id.toLowerCase() === str) {
        return def.id;
      }
      if (def.aliases.some((a) => a.toLowerCase() === str)) {
        return def.id;
      }
      if (def.folderAliases.some((fa) => fa.toLowerCase() === str)) {
        return def.id;
      }
    }

    // 3. Heuristic matching for common variations
    if (str.includes('genesis') || str.includes('megadrive') || str.includes('mega drive') || str === 'md') return 'Retro';
    if (str.includes('playstation 2') || str.includes('ps2') || str === 'sony playstation 2') return 'PlayStation 2';
    if (str.includes('playstation 3') || str.includes('ps3') || str === 'sony playstation 3') return 'PlayStation 3';
    if (str.includes('playstation') || str.includes('ps1') || str.includes('psx') || str.includes('psone')) return 'PlayStation';
    if (str.includes('psp') || str.includes('portable')) return 'PSP';
    if (str.includes('gamecube') || str.includes('game cube') || str === 'ngc') return 'GameCube';
    if (str.includes('wii u')) return undefined;
    if (str.includes('wii')) return 'Wii';
    if (str.includes('dreamcast') || str === 'dc') return 'Dreamcast';
    if (str.includes('switch')) return 'Nintendo Switch';
    if (str.includes('nintendo 64') || str.includes('n64')) return 'Nintendo 64';
    if (str.includes('advance') || str.includes('gba')) return 'Game Boy Advance';
    if (str.includes('color') || str.includes('gbc')) return 'Game Boy Color';
    if (str.includes('game boy') || str === 'gb') return 'Game Boy';
    if (str.includes('3ds')) return 'Nintendo 3DS';
    if (str.includes('nds') || str === 'ds' || /\bds\b/.test(str)) return 'Nintendo DS';
    if (str.includes('super nintendo') || str.includes('snes') || str.includes('super famicom') || str.includes('sfc')) return 'SNES';
    if (str.includes('famicom') || str.includes('nintendo entertainment system') || /\bnes\b/.test(str)) return 'NES';
    if (str.includes('windows') || str.includes('dos') || /\bpc\b/.test(str)) return 'PC';

    return undefined;
  }

  /**
   * Retrieves the ScreenScraper numeric system ID for a platform.
   */
  public static toScreenScraperSystemId(platform: GamePlatform | string): number | undefined {
    const canonical = this.toGamePlatform(platform);
    if (!canonical) return undefined;
    return SCREENSCRAPER_SYSTEM_IDS[canonical];
  }

  public static getScreenScraperSystemId(platform: GamePlatform | string): number | undefined {
    return this.toScreenScraperSystemId(platform);
  }

  public static fromScreenScraperSystemId(systemId: number | string): GamePlatform | undefined {
    const num = Number(systemId);
    if (isNaN(num)) return undefined;
    for (const [platform, id] of Object.entries(SCREENSCRAPER_SYSTEM_IDS)) {
      if (id === num) {
        return this.toGamePlatform(platform);
      }
    }
    return undefined;
  }

  public static isPlatformSupported(platform: string): boolean {
    const canonical = this.toGamePlatform(platform);
    if (!canonical || canonical === 'Unknown') return false;
    return Object.prototype.hasOwnProperty.call(PLATFORM_DEFINITIONS, canonical);
  }
}
