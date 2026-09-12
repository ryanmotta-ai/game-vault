export class ExtensionRegistry {
  public static readonly EXCLUSIVE_ROMS = new Set([
    '.chd',
    '.rvz',
    '.nsp',
    '.xci',
    '.z64',
    '.n64',
    '.v64',
    '.nds',
    '.3ds',
    '.cci',
    '.cia',
    '.gba',
    '.gbc',
    '.gb',
    '.nes',
    '.sfc',
    '.smc',
    '.wbfs',
    '.cso',
    '.pbp',
    '.gdi',
    '.cdi',
    '.gcz',
    '.xbe',
    '.xex'
  ]);

  public static readonly AMBIGUOUS_EXTENSIONS = new Set([
    '.iso',
    '.bin',
    '.cue',
    '.zip',
    '.7z',
    '.rar',
    '.exe',
    '.pkg',
    '.rom'
  ]);

  public static readonly IGNORED_EXTENSIONS = new Set([
    '.txt',
    '.nfo',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.mp3',
    '.flac',
    '.wav',
    '.ogg',
    '.mp4',
    '.mkv',
    '.avi',
    '.mov',
    '.srt',
    '.sub',
    '.url',
    '.lnk',
    '.desktop',
    '.ds_store',
    '.thumbs.db',
    '.md',
    '.json',
    '.xml',
    '.ini',
    '.cfg',
    '.log',
    '.bat',
    '.sh',
    '.torrent'
  ]);

  public static normalizeExtension(filename: string): string {
    const lower = filename.toLowerCase().trim();

    // Special compound extensions
    if (lower.endsWith('.nkit.iso')) return '.nkit.iso';

    const lastDot = lower.lastIndexOf('.');
    if (lastDot === -1) return '';
    return lower.substring(lastDot);
  }

  public static isExclusiveRom(ext: string): boolean {
    const clean = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return this.EXCLUSIVE_ROMS.has(clean);
  }

  public static isAmbiguous(ext: string): boolean {
    const clean = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return this.AMBIGUOUS_EXTENSIONS.has(clean);
  }

  public static isIgnored(filename: string, ext?: string): boolean {
    const cleanExt = ext
      ? (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
      : this.normalizeExtension(filename);
    const cleanName = filename.toLowerCase().trim();

    if (this.IGNORED_EXTENSIONS.has(cleanExt)) return true;
    if (cleanName === '.ds_store' || cleanName === 'thumbs.db' || cleanName.startsWith('.')) return true;
    return false;
  }
}
