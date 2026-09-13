import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import { logger } from '../core/logger';
import { isSubPath, sanitizeFilename } from '../core/utils/pathSafety';
import { GameArtworkType, ArtworkCacheStats } from './types';
import { GameArtworkRepository, GameArtworkRecord } from '../database/repositories/gameArtworkRepository';

export interface DownloadArtworkOptions {
  gameId: string;
  remoteUrl: string;
  assetType: 'cover' | 'banner' | 'logo' | 'screenshot' | GameArtworkType;
  provider?: string;
  index?: number;
  timeoutMs?: number;
  overwrite?: boolean;
  isPrimary?: boolean;
}

export interface ArtworkCacheManagerOptions {
  artworkBaseDir: string;
  artworkRepo?: GameArtworkRepository;
  allowLocalhost?: boolean;
  maxConcurrentDownloads?: number;
}

export class ArtworkCacheManager {
  private log = logger.child('ArtworkCacheManager');
  private artworkBaseDir: string;
  private artworkRepo?: GameArtworkRepository;
  private allowLocalhost: boolean;
  private activeDownloads = 0;
  private maxConcurrentDownloads: number;
  private downloadQueue: Array<() => void> = [];

  public static readonly MAX_COVER_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
  public static readonly MAX_BACKGROUND_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

  constructor(options: string | ArtworkCacheManagerOptions) {
    if (typeof options === 'string') {
      this.artworkBaseDir = options;
      this.allowLocalhost = process.env.NODE_ENV === 'test';
      this.maxConcurrentDownloads = 4;
    } else {
      this.artworkBaseDir = options.artworkBaseDir;
      this.artworkRepo = options.artworkRepo;
      this.allowLocalhost = options.allowLocalhost ?? (process.env.NODE_ENV === 'test');
      this.maxConcurrentDownloads = options.maxConcurrentDownloads || 4;
    }

    this.ensureDirectory(this.artworkBaseDir);
  }

  public setArtworkRepository(repo: GameArtworkRepository): void {
    this.artworkRepo = repo;
  }

  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  public getBaseDir(): string {
    return this.artworkBaseDir;
  }

  public getGameArtworkDir(gameId: string): string {
    const safeId = sanitizeFilename(gameId);
    return path.join(this.artworkBaseDir, safeId);
  }

  /**
   * SSRF Protection: rejects loopback and private IPv4/IPv6 addresses
   * unless explicitly allowed for testing.
   */
  public isSafeRemoteUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();

      // Check loopback / localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return this.allowLocalhost;
      }

      // Check private IPv4 ranges
      const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipv4Match) {
        const [, oct1, oct2] = ipv4Match.map(Number);

        // 10.0.0.0/8
        if (oct1 === 10) return false;
        // 172.16.0.0/12
        if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return false;
        // 192.168.0.0/16
        if (oct1 === 192 && oct2 === 168) return false;
        // 169.254.0.0/16 (link-local)
        if (oct1 === 169 && oct2 === 254) return false;
        // 0.0.0.0
        if (oct1 === 0) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Translates a local filesystem path into an Electron-renderable URI scheme.
   */
  public toAssetUrl(localPath?: string): string {
    if (!localPath) return '';
    if (localPath.startsWith('http://') || localPath.startsWith('https://') || localPath.startsWith('data:')) {
      return localPath;
    }
    const normalized = localPath.replace(/\\/g, '/');
    return `local-artwork://${encodeURIComponent(normalized)}`;
  }

  private acquireSlot(): Promise<void> {
    if (this.activeDownloads < this.maxConcurrentDownloads) {
      this.activeDownloads++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.downloadQueue.push(() => {
        this.activeDownloads++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeDownloads--;
    if (this.downloadQueue.length > 0) {
      const next = this.downloadQueue.shift();
      if (next) next();
    }
  }

  private detectExtension(url: string, contentType?: string): string {
    if (contentType) {
      const ct = contentType.toLowerCase();
      if (ct.includes('image/png')) return '.png';
      if (ct.includes('image/webp')) return '.webp';
      if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';
      if (ct.includes('image/gif')) return '.gif';
      if (ct.includes('image/avif')) return '.avif';
    }
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
        return ext === '.jpeg' ? '.jpg' : ext;
      }
    } catch {
      // Fallback
    }
    return '.jpg';
  }

  private mapAssetTypeToArtworkType(assetType: string): GameArtworkType {
    const normalized = assetType.toUpperCase();
    if (normalized === 'COVER' || normalized === 'COVER_FRONT') return 'COVER_FRONT';
    if (normalized === 'BANNER' || normalized === 'BACKGROUND') return 'BACKGROUND';
    if (normalized === 'LOGO' || normalized === 'WHEEL') return 'LOGO';
    if (normalized === 'SCREENSHOT') return 'SCREENSHOT';
    if (normalized === 'BOX_3D') return 'BOX_3D';
    if (normalized === 'FANART') return 'FANART';
    return 'COVER_FRONT';
  }

  /**
   * Downloads a remote artwork file, validates MIME type, size limit and SSRF, and caches on disk.
   */
  public async downloadAndCache(options: DownloadArtworkOptions): Promise<string> {
    const {
      gameId,
      remoteUrl,
      assetType,
      provider = 'remote',
      index = 0,
      timeoutMs = 15000,
      overwrite = false,
      isPrimary = true
    } = options;

    if (!remoteUrl || typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
      return '';
    }

    // Support data URLs directly
    if (remoteUrl.startsWith('data:image/')) {
      const saved = this.saveDataUrl(gameId, remoteUrl, assetType, index);
      if (saved && this.artworkRepo) {
        this.registerArtworkInDb(gameId, this.mapAssetTypeToArtworkType(assetType), provider, saved, remoteUrl, isPrimary, false);
      }
      return saved;
    }

    // SSRF Check
    if (!this.isSafeRemoteUrl(remoteUrl)) {
      this.log.warn(`SSRF Blocked: Unsafe remote artwork URL rejected: ${remoteUrl}`);
      return '';
    }

    const gameDir = this.getGameArtworkDir(gameId);
    this.ensureDirectory(gameDir);

    const prefix = assetType.toLowerCase() === 'screenshot' ? `screenshot_${index}` : assetType.toLowerCase();

    // Check if an existing file already exists
    if (!overwrite) {
      const existing = this.findExistingAsset(gameDir, prefix);
      if (existing) {
        return existing;
      }
    }

    await this.acquireSlot();

    try {
      const artworkType = this.mapAssetTypeToArtworkType(assetType);
      const isBackgroundOrScreenshot = artworkType === 'BACKGROUND' || artworkType === 'SCREENSHOT' || artworkType === 'FANART';
      const maxBytes = isBackgroundOrScreenshot
        ? ArtworkCacheManager.MAX_BACKGROUND_SIZE_BYTES
        : ArtworkCacheManager.MAX_COVER_SIZE_BYTES;

      const finalPath = await this.fetchAndSave(remoteUrl, gameDir, prefix, timeoutMs, maxBytes);

      if (finalPath && this.artworkRepo) {
        this.registerArtworkInDb(gameId, artworkType, provider, finalPath, remoteUrl, isPrimary, false);
      }

      return finalPath;
    } catch (err) {
      this.log.warn(`Failed to download artwork for game ${gameId} (${assetType}) from ${remoteUrl}:`, err);
      return '';
    } finally {
      this.releaseSlot();
    }
  }

  private registerArtworkInDb(
    gameId: string,
    type: GameArtworkType,
    provider: string,
    localPath: string,
    sourceUrl?: string,
    isPrimary: boolean = true,
    isUserCustom: boolean = false
  ): void {
    if (!this.artworkRepo) return;
    try {
      const stats = fs.statSync(localPath);
      const ext = path.extname(localPath).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.gif') mimeType = 'image/gif';

      const record: GameArtworkRecord = {
        id: crypto.randomUUID(),
        gameId,
        type,
        provider,
        sourceUrl,
        localPath,
        mimeType,
        fileSize: stats.size,
        isPrimary,
        isUserCustom,
        status: 'CACHED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.artworkRepo.upsert(record);
    } catch (err) {
      this.log.warn(`Failed to record artwork in database for game ${gameId}:`, err);
    }
  }

  /**
   * Saves a user-provided custom image file into the artwork directory.
   */
  public async saveCustomArtwork(
    gameId: string,
    type: GameArtworkType,
    sourceFilePath: string
  ): Promise<string> {
    if (!fs.existsSync(sourceFilePath)) {
      throw new Error(`Source artwork file does not exist: ${sourceFilePath}`);
    }

    const ext = path.extname(sourceFilePath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
      throw new Error(`Unsupported image format: ${ext}`);
    }

    const gameDir = this.getGameArtworkDir(gameId);
    this.ensureDirectory(gameDir);

    const prefix = `custom_${type.toLowerCase()}`;
    const targetPath = path.join(gameDir, `${prefix}${ext}`);

    // If source and target are the same file, do nothing
    if (path.resolve(sourceFilePath) !== path.resolve(targetPath)) {
      fs.copyFileSync(sourceFilePath, targetPath);
    }

    // Register as primary, custom user artwork
    this.registerArtworkInDb(gameId, type, 'user_custom', targetPath, undefined, true, true);

    this.log.info(`Saved custom artwork (${type}) for game '${gameId}' -> ${targetPath}`);
    return targetPath;
  }

  public findExistingAsset(gameDir: string, prefix: string): string | null {
    if (!fs.existsSync(gameDir)) return null;
    const files = fs.readdirSync(gameDir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const base = path.basename(file, ext);
      if (base === prefix && ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
        const fullPath = path.join(gameDir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size > 0) return fullPath;
        } catch {
          // Continue
        }
      }
    }
    return null;
  }

  private saveDataUrl(gameId: string, dataUrl: string, assetType: string, index: number): string {
    try {
      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9-+.]+);base64,(.+)$/);
      if (!match) return '';
      const rawExt = match[1].toLowerCase();
      const ext = rawExt === 'jpeg' ? '.jpg' : `.${rawExt}`;
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const gameDir = this.getGameArtworkDir(gameId);
      this.ensureDirectory(gameDir);

      const prefix = assetType.toLowerCase() === 'screenshot' ? `screenshot_${index}` : assetType.toLowerCase();
      const filename = `${prefix}${ext}`;
      const targetPath = path.join(gameDir, filename);
      fs.writeFileSync(targetPath, buffer);
      return targetPath;
    } catch (err) {
      this.log.error(`Failed to save data URL for ${gameId}:`, err);
      return '';
    }
  }

  private fetchAndSave(
    urlStr: string,
    destDir: string,
    prefix: string,
    timeoutMs: number,
    maxBytes: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(urlStr);
      } catch (err) {
        return reject(new Error(`Invalid URL: ${urlStr}`));
      }

      const client = url.protocol === 'http:' ? http : https;
      const headers = {
        'User-Agent': 'GameVault/0.8.0 (Desktop; Gaming Vault Client)',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      };

      const req = client.get(url, { headers, timeout: timeoutMs }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).href;
          if (!this.isSafeRemoteUrl(redirectUrl)) {
            res.resume();
            return reject(new Error(`SSRF Blocked redirect to unsafe URL: ${redirectUrl}`));
          }
          res.resume();
          return this.fetchAndSave(redirectUrl, destDir, prefix, timeoutMs, maxBytes).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
        }

        const contentType = res.headers['content-type'] || '';
        // Strict MIME validation: must be an image
        if (contentType && !contentType.toLowerCase().includes('image/')) {
          res.resume();
          return reject(new Error(`Invalid Content-Type '${contentType}': expected image MIME type`));
        }

        const ext = this.detectExtension(urlStr, contentType);
        const tempPath = path.join(destDir, `${prefix}_${Date.now()}.tmp`);
        const finalPath = path.join(destDir, `${prefix}${ext}`);

        const fileStream = fs.createWriteStream(tempPath);
        let downloadedBytes = 0;

        res.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxBytes) {
            req.destroy(new Error(`Artwork size exceeded limit of ${maxBytes} bytes`));
            fileStream.close();
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(finalPath)) {
                fs.unlinkSync(finalPath);
              }
              fs.renameSync(tempPath, finalPath);
              resolve(finalPath);
            } catch (err) {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(err);
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Retrieves all cached artwork paths for a given game.
   */
  public getCachedArtwork(gameId: string): {
    coverPath?: string;
    bannerPath?: string;
    logoPath?: string;
    screenshotPaths: string[];
  } {
    const gameDir = this.getGameArtworkDir(gameId);
    const result: { coverPath?: string; bannerPath?: string; logoPath?: string; screenshotPaths: string[] } = {
      screenshotPaths: []
    };

    if (!fs.existsSync(gameDir)) return result;

    try {
      const files = fs.readdirSync(gameDir);
      for (const file of files) {
        const full = path.join(gameDir, file);
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file, ext);

        if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) continue;

        if (base === 'cover' || base === 'custom_cover_front') {
          result.coverPath = full;
        } else if (base === 'banner' || base === 'background' || base === 'custom_background') {
          result.bannerPath = full;
        } else if (base === 'logo' || base === 'wheel' || base === 'custom_logo') {
          result.logoPath = full;
        } else if (base.startsWith('screenshot_')) {
          result.screenshotPaths.push(full);
        }
      }

      result.screenshotPaths.sort();
    } catch (err) {
      this.log.error(`Error reading cached artwork for ${gameId}:`, err);
    }

    return result;
  }

  /**
   * Computes cache directory statistics.
   */
  public async getCacheStats(): Promise<ArtworkCacheStats> {
    const stats: ArtworkCacheStats = {
      totalFiles: 0,
      totalSizeBytes: 0,
      coversCount: 0,
      bannersCount: 0,
      logosCount: 0,
      screenshotsCount: 0
    };

    if (!fs.existsSync(this.artworkBaseDir)) {
      return stats;
    }

    const walk = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const fullPath = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(fullPath);
          } else if (ent.isFile()) {
            const ext = path.extname(ent.name).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
              stats.totalFiles++;
              try {
                const s = fs.statSync(fullPath);
                stats.totalSizeBytes += s.size;
              } catch {}

              const base = path.basename(ent.name, ext).toLowerCase();
              if (base === 'cover' || base.includes('cover')) stats.coversCount++;
              else if (base === 'banner' || base.includes('background') || base.includes('fanart')) stats.bannersCount++;
              else if (base === 'logo' || base.includes('wheel') || base.includes('logo')) stats.logosCount++;
              else if (base.startsWith('screenshot_')) stats.screenshotsCount++;
            }
          }
        }
      } catch (err) {
        this.log.warn(`Error scanning directory ${dir}:`, err);
      }
    };

    walk(this.artworkBaseDir);
    return stats;
  }

  /**
   * Purges cached artwork for a specific game or the entire cache.
   */
  public async clearCache(gameId?: string): Promise<void> {
    if (gameId) {
      const gameDir = this.getGameArtworkDir(gameId);
      if (fs.existsSync(gameDir)) {
        if (!isSubPath(this.artworkBaseDir, gameDir)) {
          throw new Error('Security violation: Attempted deletion outside artwork directory');
        }
        fs.rmSync(gameDir, { recursive: true, force: true });
        this.log.info(`Cleared artwork cache for game ${gameId}`);
      }
      return;
    }

    // Clear entire artwork directory
    if (fs.existsSync(this.artworkBaseDir)) {
      const entries = fs.readdirSync(this.artworkBaseDir);
      for (const entry of entries) {
        const target = path.join(this.artworkBaseDir, entry);
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch (err) {
          this.log.warn(`Failed to remove ${target}:`, err);
        }
      }
      this.log.info('Cleared all artwork cache');
    }
  }
}
