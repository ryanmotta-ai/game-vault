/**
 * Normalizes raw ROM, ISO, and game archive filenames into clean, searchable game titles.
 * Removes common preservation dump tags, version indicators, disc/track labels, and file extensions.
 */

// Common emulator and ROM dump patterns:
// (USA), (Japan), (Europe), (Rev 1), (v1.0), (Disc 1), (Track 01), [!], [b1], [a1], [MULTI5], etc.
const EXTENSIONS_REGEX = /\.(zip|7z|rar|iso|cso|chd|bin|cue|rom|smc|sfc|nes|fds|z64|n64|v64|gba|gbc|gb|nds|3ds|nsp|xci|wbfs|gcm|rvz|wad|pbp|exe|lnk)$/i;

const PARENTHESES_TAGS_REGEX = /\s*\([^)]*\)/g;
const BRACKETS_TAGS_REGEX = /\s*\[[^\]]*\]/g;
const DISC_INDICATORS_REGEX = /\b(disc|disk|cd)\s*\d+(\s*of\s*\d+)?\b/gi;
const TRACK_INDICATORS_REGEX = /\btrack\s*\d+\b/gi;
const UNDERSCORES_DASHES_REGEX = /[_\s]+/g;

export interface SanitizedTitleResult {
  raw: string;
  cleanTitle: string;
  detectedDisc?: number;
  tags: string[];
}

export function cleanGameTitle(rawTitle: string): string {
  return sanitizeGameTitle(rawTitle).cleanTitle;
}

export function sanitizeGameTitle(rawTitle: string): SanitizedTitleResult {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return { raw: rawTitle || '', cleanTitle: '', tags: [] };
  }

  let text = rawTitle.trim();

  // 1. Strip file extension if present
  text = text.replace(EXTENSIONS_REGEX, '');

  // 2. Extract disc number if present (e.g. "Disc 1", "CD 2")
  let detectedDisc: number | undefined;
  const discMatch = text.match(/\b(?:disc|disk|cd)\s*(\d+)/i);
  if (discMatch && discMatch[1]) {
    detectedDisc = parseInt(discMatch[1], 10);
  }

  // 3. Extract bracket and parenthesis tags for metadata insight
  const tags: string[] = [];
  const foundParens = text.match(/\(([^)]+)\)/g) || [];
  const foundBrackets = text.match(/\[([^\]]+)\]/g) || [];

  for (const p of foundParens) {
    const inside = p.slice(1, -1).trim();
    if (inside) tags.push(inside);
  }
  for (const b of foundBrackets) {
    const inside = b.slice(1, -1).trim();
    if (inside) tags.push(inside);
  }

  // 4. Strip specific Disc / Track words
  text = text.replace(DISC_INDICATORS_REGEX, '');
  text = text.replace(TRACK_INDICATORS_REGEX, '');

  // 5. Strip all bracketed tags: [!], [b1], [En,Ja], [SCUS-12345]
  text = text.replace(BRACKETS_TAGS_REGEX, '');

  // 6. Strip all parenthesized tags: (USA), (Rev 1), (v1.2), (Beta)
  text = text.replace(PARENTHESES_TAGS_REGEX, '');

  // 7. Normalize underscores to spaces and collapse repeated whitespace
  text = text.replace(UNDERSCORES_DASHES_REGEX, ' ').trim();

  // 8. Clean up any trailing hyphens, dots, or stray punctuation
  text = text.replace(/[-–—.]+$/, '').trim();

  // If cleaning resulted in an empty string (unlikely), fallback to original without extension
  if (!text) {
    text = rawTitle.replace(EXTENSIONS_REGEX, '').trim();
  }

  return {
    raw: rawTitle,
    cleanTitle: text,
    detectedDisc,
    tags
  };
}
