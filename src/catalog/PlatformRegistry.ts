import { GamePlatform } from '../core/types';

export interface PlatformDefinition {
  id: GamePlatform;
  displayName: string;
  aliases: string[];
  extensions: string[];
  folderAliases: string[];
}

export const PLATFORM_DEFINITIONS: Record<GamePlatform, PlatformDefinition> = {
  'PC': {
    id: 'PC',
    displayName: 'PC (Windows / DOS)',
    aliases: ['pc', 'windows', 'win', 'dos'],
    extensions: ['.exe', '.zip', '.7z', '.rar'],
    folderAliases: ['pc', 'windows', 'pc games', 'pcgames', 'pc-games', 'dos']
  },
  'PlayStation': {
    id: 'PlayStation',
    displayName: 'PlayStation',
    aliases: ['ps1', 'psx', 'playstation', 'playstation 1', 'psone'],
    extensions: ['.bin', '.cue', '.chd', '.pbp', '.iso', '.img'],
    folderAliases: ['ps1', 'psx', 'playstation', 'playstation 1', 'playstation1', 'ps 1', 'psone']
  },
  'PlayStation 2': {
    id: 'PlayStation 2',
    displayName: 'PlayStation 2',
    aliases: ['ps2', 'playstation 2', 'playstation2', 'sony ps2', 'pcsx2'],
    extensions: ['.iso', '.chd', '.cso', '.bin', '.gz'],
    folderAliases: ['ps2', 'playstation 2', 'playstation2', 'sony ps2', 'pcsx2', 'ps 2']
  },
  'PlayStation 3': {
    id: 'PlayStation 3',
    displayName: 'PlayStation 3',
    aliases: ['ps3', 'playstation 3', 'playstation3', 'rpcs3'],
    extensions: ['.iso', '.pkg'],
    folderAliases: ['ps3', 'playstation 3', 'playstation3', 'ps 3', 'rpcs3']
  },
  'PSP': {
    id: 'PSP',
    displayName: 'PlayStation Portable',
    aliases: ['psp', 'playstation portable', 'ppsspp'],
    extensions: ['.iso', '.cso', '.pbp'],
    folderAliases: ['psp', 'playstation portable', 'ppsspp']
  },
  'GameCube': {
    id: 'GameCube',
    displayName: 'Nintendo GameCube',
    aliases: ['gamecube', 'game cube', 'gc', 'ngc', 'dolphin'],
    extensions: ['.iso', '.gcz', '.rvz', '.ciso', '.nkit.iso'],
    folderAliases: ['gamecube', 'game cube', 'gc', 'ngc', 'dolphin']
  },
  'Wii': {
    id: 'Wii',
    displayName: 'Nintendo Wii',
    aliases: ['wii', 'nintendo wii'],
    extensions: ['.iso', '.wbfs', '.rvz', '.ciso', '.nkit.iso'],
    folderAliases: ['wii', 'nintendo wii']
  },
  'Dreamcast': {
    id: 'Dreamcast',
    displayName: 'Sega Dreamcast',
    aliases: ['dreamcast', 'sega dreamcast', 'dc'],
    extensions: ['.gdi', '.cdi', '.chd'],
    folderAliases: ['dreamcast', 'sega dreamcast', 'dc']
  },
  'Nintendo Switch': {
    id: 'Nintendo Switch',
    displayName: 'Nintendo Switch',
    aliases: ['switch', 'nintendo switch', 'nx', 'yuzu', 'ryujinx'],
    extensions: ['.nsp', '.xci'],
    folderAliases: ['switch', 'nintendo switch', 'nx', 'yuzu', 'ryujinx']
  },
  'Nintendo 64': {
    id: 'Nintendo 64',
    displayName: 'Nintendo 64',
    aliases: ['n64', 'nintendo 64', 'nintendo64'],
    extensions: ['.z64', '.n64', '.v64'],
    folderAliases: ['n64', 'nintendo 64', 'nintendo64']
  },
  'Nintendo DS': {
    id: 'Nintendo DS',
    displayName: 'Nintendo DS',
    aliases: ['nds', 'nintendo ds', 'ds'],
    extensions: ['.nds'],
    folderAliases: ['nds', 'nintendo ds', 'ds']
  },
  'Nintendo 3DS': {
    id: 'Nintendo 3DS',
    displayName: 'Nintendo 3DS',
    aliases: ['3ds', 'nintendo 3ds', 'citra'],
    extensions: ['.3ds', '.cci', '.cia'],
    folderAliases: ['3ds', 'nintendo 3ds', 'citra']
  },
  'Game Boy': {
    id: 'Game Boy',
    displayName: 'Game Boy',
    aliases: ['gb', 'gameboy', 'game boy'],
    extensions: ['.gb'],
    folderAliases: ['gb', 'gameboy', 'game boy']
  },
  'Game Boy Color': {
    id: 'Game Boy Color',
    displayName: 'Game Boy Color',
    aliases: ['gbc', 'gameboy color', 'game boy color'],
    extensions: ['.gbc'],
    folderAliases: ['gbc', 'gameboy color', 'game boy color']
  },
  'Game Boy Advance': {
    id: 'Game Boy Advance',
    displayName: 'Game Boy Advance',
    aliases: ['gba', 'game boy advance', 'gameboy advance', 'mgba'],
    extensions: ['.gba'],
    folderAliases: ['gba', 'game boy advance', 'gameboy advance', 'mgba']
  },
  'NES': {
    id: 'NES',
    displayName: 'Nintendo Entertainment System',
    aliases: ['nes', 'famicom', 'nintendo entertainment system'],
    extensions: ['.nes'],
    folderAliases: ['nes', 'famicom', 'nintendo entertainment system', 'nintendo nes']
  },
  'SNES': {
    id: 'SNES',
    displayName: 'Super Nintendo',
    aliases: ['snes', 'super nintendo', 'super famicom', 'sfc'],
    extensions: ['.sfc', '.smc'],
    folderAliases: ['snes', 'super nintendo', 'super famicom', 'sfc']
  },
  'Xbox': {
    id: 'Xbox',
    displayName: 'Original Xbox',
    aliases: ['xbox', 'original xbox', 'xbox classic'],
    extensions: ['.iso', '.xbe'],
    folderAliases: ['xbox', 'original xbox', 'xbox classic', 'xbox 1']
  },
  'Xbox 360': {
    id: 'Xbox 360',
    displayName: 'Xbox 360',
    aliases: ['xbox 360', 'xbox360', 'x360', 'xenia'],
    extensions: ['.iso', '.xex'],
    folderAliases: ['xbox 360', 'xbox360', 'x360', 'xenia']
  },
  'Retro': {
    id: 'Retro',
    displayName: 'Retro / Arcade',
    aliases: ['retro', 'arcade', 'mame'],
    extensions: ['.rom', '.bin'],
    folderAliases: ['retro', 'arcade', 'mame', 'roms']
  },
  'Unknown': {
    id: 'Unknown',
    displayName: 'Unknown Platform',
    aliases: ['unknown'],
    extensions: [],
    folderAliases: []
  }
};

export class PlatformRegistry {
  public static getAllPlatforms(): PlatformDefinition[] {
    return Object.values(PLATFORM_DEFINITIONS);
  }

  public static getDefinition(platform: GamePlatform): PlatformDefinition {
    return PLATFORM_DEFINITIONS[platform] || PLATFORM_DEFINITIONS['Unknown'];
  }

  /**
   * Detects candidate platform by matching path segments against folderAliases.
   * Scans path segments from innermost folder outwards.
   */
  public static detectPlatformFromPath(remotePath: string): GamePlatform | null {
    if (!remotePath) return null;

    // Split path into segments
    const normalized = remotePath.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);

    // Check directory names (exclude the filename itself at last index)
    const folderSegments = segments.slice(0, segments.length - 1).reverse();

    for (const segment of folderSegments) {
      const cleanSegment = segment.trim().replace(/^\[|\]$/g, '');

      // 1. Exact match check first
      for (const def of Object.values(PLATFORM_DEFINITIONS)) {
        if (def.id === 'Unknown' || def.id === 'Retro') continue;
        for (const alias of def.folderAliases) {
          if (cleanSegment === alias) {
            return def.id;
          }
        }
      }

      // 2. Prefix or suffix match (e.g. "PS2 Games" or "Roms PS2")
      for (const def of Object.values(PLATFORM_DEFINITIONS)) {
        if (def.id === 'Unknown' || def.id === 'Retro') continue;
        for (const alias of def.folderAliases) {
          if (cleanSegment.startsWith(`${alias} `) || cleanSegment.endsWith(` ${alias}`)) {
            return def.id;
          }
        }
      }
    }

    return null;
  }

  /**
   * Comprehensive detection combining path cues with extension recognition.
   */
  public static detectPlatform(remotePath: string, ext?: string): GamePlatform {
    const fromPath = this.detectPlatformFromPath(remotePath);
    if (fromPath) return fromPath;
    if (ext) {
      const candidates = this.getPlatformsByExtension(ext);
      if (candidates.length === 1) return candidates[0];
    }
    return 'Unknown';
  }

  /**
   * Finds platforms that support a given file extension.
   */
  public static getPlatformsByExtension(ext: string): GamePlatform[] {
    const cleanExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const matches: GamePlatform[] = [];

    for (const def of Object.values(PLATFORM_DEFINITIONS)) {
      if (def.id === 'Unknown') continue;
      if (def.extensions.includes(cleanExt)) {
        matches.push(def.id);
      }
    }

    return matches;
  }
}
