import path from 'node:path';
import { Game, GameFile, GameIdentityQuery, GamePlatform } from '../core/types';
import { sanitizeGameTitle } from './titleSanitizer';
import { MetadataPlatformMapper } from './MetadataPlatformMapper';

export class GameIdentificationService {
  /**
   * Normalizes raw region tags into canonical region codes (NA, EU, JP, WORLD).
   */
  public static normalizeRegion(rawRegion?: string): string | undefined {
    if (!rawRegion) return undefined;
    const r = rawRegion.trim().toUpperCase();

    if (['USA', 'US', 'NTSC-U', 'NORTH AMERICA', 'NA'].includes(r)) {
      return 'NA';
    }
    if (['EUROPE', 'PAL', 'EUR', 'EU', 'EN,FR,DE', 'MULTI5', 'FRANCE', 'GERMANY', 'SPAIN', 'ITALY'].includes(r)) {
      return 'EU';
    }
    if (['JAPAN', 'JP', 'NTSC-J', 'JPN'].includes(r)) {
      return 'JP';
    }
    if (['WORLD', 'GLOBAL', 'W'].includes(r)) {
      return 'WORLD';
    }

    return rawRegion;
  }

  /**
   * Extracts disc number from title or filename (e.g. "Disc 1", "CD 2").
   */
  public static extractDiscNumber(text: string): number | undefined {
    const match = text.match(/\b(?:disc|disk|cd)\s*(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return undefined;
  }

  /**
   * Extracts game serial codes from brackets or text (e.g. SCUS-94163, SLUS-20672, NTR-AMHE-USA).
   */
  public static extractSerial(text: string): string | undefined {
    const serialMatch = text.match(/\b([A-Z]{3,4}[-_]\d{3,5}|[A-Z]{3}-[A-Z0-9]{4}-[A-Z]{3})\b/i);
    if (serialMatch && serialMatch[1]) {
      return serialMatch[1].toUpperCase();
    }
    return undefined;
  }

  /**
   * Builds a structured GameIdentityQuery for a given Game and its files.
   */
  public static identify(game: Game, primaryFile?: GameFile): GameIdentityQuery {
    const filename = primaryFile?.filename;
    const extension = filename ? path.extname(filename).toLowerCase() : undefined;

    // Use filename as initial title candidate if game title is generic or slug-like
    const rawToSanitize = filename ? filename : game.title;
    const sanitized = sanitizeGameTitle(rawToSanitize);

    // If game title is already well-formatted, sanitize both and choose best clean title
    const gameSanitized = sanitizeGameTitle(game.title);
    const cleanTitle = gameSanitized.cleanTitle.length > 0 ? gameSanitized.cleanTitle : sanitized.cleanTitle;

    // Tags from both sources
    const combinedTags = Array.from(new Set([...sanitized.tags, ...gameSanitized.tags]));

    // Detect region from tags
    let detectedRegion: string | undefined;
    for (const tag of combinedTags) {
      const norm = this.normalizeRegion(tag);
      if (['NA', 'EU', 'JP', 'WORLD'].includes(norm || '')) {
        detectedRegion = norm;
        break;
      }
    }

    // Detect disc number
    const discNumber = sanitized.detectedDisc || gameSanitized.detectedDisc || this.extractDiscNumber(rawToSanitize);

    // Detect serial code
    const serial = this.extractSerial(rawToSanitize) || (primaryFile?.remotePath ? this.extractSerial(primaryFile.remotePath) : undefined);

    // Platform mapping
    const normalizedPlatform = MetadataPlatformMapper.toGamePlatform(game.platform) || (game.platform as GamePlatform);

    return {
      gameId: game.id,
      title: game.title,
      cleanTitle,
      platform: game.platform,
      normalizedPlatform,
      filename,
      extension,
      region: detectedRegion,
      discNumber,
      serial,
      md5: primaryFile?.md5Checksum,
      releaseYearHint: game.releaseYear
    };
  }
}
