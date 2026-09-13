import { GamesRepository } from '../database/repositories/gamesRepository';
import { Game } from '../core/types';
import { MetadataProvider, MetadataSearchResult } from '../integrations/metadata/MetadataProvider';
import { ArtworkCacheManager } from './ArtworkCacheManager';
import { cleanGameTitle } from './titleSanitizer';
import { GameMetadataScraped, MetadataProgressEvent, MetadataSearchQuery } from './types';
import { logger } from '../core/logger';

export interface MetadataServiceOptions {
  gamesRepo: GamesRepository;
  artworkCache: ArtworkCacheManager;
  providers?: MetadataProvider[];
}

export class MetadataService {
  private log = logger.child('MetadataService');
  private gamesRepo: GamesRepository;
  private artworkCache: ArtworkCacheManager;
  private providers: MetadataProvider[] = [];

  constructor(options: MetadataServiceOptions) {
    this.gamesRepo = options.gamesRepo;
    this.artworkCache = options.artworkCache;
    if (options.providers) {
      this.providers = [...options.providers];
    }
  }

  public registerProvider(provider: MetadataProvider): void {
    const existingIdx = this.providers.findIndex((p) => p.id === provider.id);
    if (existingIdx >= 0) {
      this.providers[existingIdx] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  public getProviders(): MetadataProvider[] {
    return [...this.providers];
  }

  public async fetchMetadata(query: MetadataSearchQuery): Promise<GameMetadataScraped | null> {
    const title = query.title;
    const cleanedTitle = cleanGameTitle(title);
    this.log.debug(`Fetching metadata for '${cleanedTitle}' across ${this.providers.length} providers`);

    for (const provider of this.providers) {
      try {
        const results = await provider.searchGame(cleanedTitle, typeof query.platform === 'string' ? query.platform : undefined);
        if (results && results.length > 0) {
          const first = results[0];
          let details: MetadataSearchResult | null = null;
          try {
            details = await provider.getGameDetails(first.id);
          } catch {
            details = null;
          }

          const match = details || first;
          return {
            title: match.title || cleanedTitle,
            description: match.description,
            coverUrl: match.coverUrl,
            bannerUrl: match.bannerUrl,
            screenshotUrls: match.screenshotUrls,
            platform: match.platform || query.platform,
            releaseYear: match.releaseYear,
            developer: match.developer,
            publisher: match.publisher,
            genres: match.genres,
            rating: match.rawScore,
            metadataSource: provider.id,
            metadataScrapedAt: new Date().toISOString()
          };
        }
      } catch (err) {
        this.log.debug(`Provider ${provider.id} search failed for '${cleanedTitle}':`, err);
      }
    }

    return null;
  }

  /**
   * Scrapes metadata for a single game, downloads and caches artwork locally,
   * updates the database record, and returns the updated game.
   */
  public async scrapeGame(gameId: string, options?: { force?: boolean }): Promise<Game> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new Error(`Game not found: ${gameId}`);
    }

    this.log.info(`Scraping metadata for '${game.title}' (${game.id})`);

    const scraped = await this.fetchMetadata({
      title: game.title,
      platform: game.platform
    });

    let localCoverPath: string | undefined = game.localCoverPath;
    let localBannerPath: string | undefined = game.localBannerPath;
    let localScreenshotPaths: string[] = game.localScreenshotPaths || [];

    const coverToDownload = scraped?.coverUrl || game.coverUrl;
    const bannerToDownload = scraped?.bannerUrl || game.bannerUrl;
    const screenshotsToDownload = scraped?.screenshotUrls || game.screenshotUrls || [];

    // Download and cache cover
    if (coverToDownload && (!localCoverPath || options?.force)) {
      try {
        const cached = await this.artworkCache.downloadAndCache({
          gameId: game.id,
          remoteUrl: coverToDownload,
          assetType: 'cover',
          overwrite: options?.force
        });
        if (cached) localCoverPath = cached;
      } catch (err) {
        this.log.warn(`Failed to cache cover for ${game.id}:`, err);
      }
    }

    // Download and cache banner
    if (bannerToDownload && (!localBannerPath || options?.force)) {
      try {
        const cached = await this.artworkCache.downloadAndCache({
          gameId: game.id,
          remoteUrl: bannerToDownload,
          assetType: 'banner',
          overwrite: options?.force
        });
        if (cached) localBannerPath = cached;
      } catch (err) {
        this.log.warn(`Failed to cache banner for ${game.id}:`, err);
      }
    }

    // Download and cache screenshots (up to 4)
    if (screenshotsToDownload.length > 0 && (localScreenshotPaths.length === 0 || options?.force)) {
      const newCachedScreenshots: string[] = [];
      const toCache = screenshotsToDownload.slice(0, 4);
      for (let i = 0; i < toCache.length; i++) {
        try {
          const cached = await this.artworkCache.downloadAndCache({
            gameId: game.id,
            remoteUrl: toCache[i],
            assetType: 'screenshot',
            index: i,
            overwrite: options?.force
          });
          if (cached) newCachedScreenshots.push(cached);
        } catch {
          // Continue
        }
      }
      if (newCachedScreenshots.length > 0) {
        localScreenshotPaths = newCachedScreenshots;
      }
    }

    // Update database record
    this.gamesRepo.updateMetadata(game.id, {
      description: scraped?.description || game.description,
      releaseYear: scraped?.releaseYear ?? game.releaseYear,
      developer: scraped?.developer || game.developer,
      publisher: scraped?.publisher || game.publisher,
      genres: scraped?.genres && scraped.genres.length > 0 ? scraped.genres : game.genres,
      rating: scraped?.rating !== undefined ? scraped.rating : game.rating,
      coverUrl: coverToDownload,
      bannerUrl: bannerToDownload,
      screenshotUrls: screenshotsToDownload,
      localCoverPath,
      localBannerPath,
      localScreenshotPaths,
      metadataSource: scraped?.metadataSource || game.metadataSource || 'manual',
      metadataScrapedAt: new Date().toISOString()
    });

    const updated = this.gamesRepo.getById(game.id);
    if (!updated) {
      throw new Error(`Failed to retrieve updated game ${game.id}`);
    }

    return updated;
  }

  /**
   * Scrapes metadata for all games or unscraped games in batches.
   */
  public async scrapeAll(options?: {
    overwrite?: boolean;
    limit?: number;
    onProgress?: (progress: MetadataProgressEvent) => void;
  }): Promise<{ total: number; scraped: number; failed: number }> {
    const games = options?.overwrite
      ? this.gamesRepo.getAll()
      : this.gamesRepo.getUnscrapedGames(options?.limit);

    const total = games.length;
    let scraped = 0;
    let failed = 0;

    this.log.info(`Starting batch metadata scraping for ${total} games (overwrite: ${Boolean(options?.overwrite)})`);

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      options?.onProgress?.({
        current: i + 1,
        total,
        gameId: game.id,
        title: game.title,
        status: 'searching'
      });

      try {
        await this.scrapeGame(game.id, { force: options?.overwrite });
        scraped++;

        options?.onProgress?.({
          current: i + 1,
          total,
          gameId: game.id,
          title: game.title,
          status: 'completed'
        });
      } catch (err) {
        failed++;
        this.log.warn(`Batch scraping failed for game ${game.id} (${game.title}):`, err);

        options?.onProgress?.({
          current: i + 1,
          total,
          gameId: game.id,
          title: game.title,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err)
        });
      }

      // Polite throttle between scraping calls (150ms)
      if (i < games.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    this.log.info(`Batch metadata scraping completed: ${scraped}/${total} scraped, ${failed} failed`);
    return { total, scraped, failed };
  }
}
