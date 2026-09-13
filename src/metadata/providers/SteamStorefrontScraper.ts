import { ExternalServiceClient } from '../../integrations/client/ExternalServiceClient';
import { MetadataProvider, MetadataSearchResult, ArtworkResult, MediaResult } from '../../integrations/metadata/MetadataProvider';
import { cleanGameTitle } from '../titleSanitizer';
import { logger } from '../../core/logger';

export interface SteamStoreSearchResult {
  total: number;
  items: Array<{
    id: number;
    name: string;
    tiny_image?: string;
    metascore?: string;
    price?: {
      currency: string;
      initial: number;
      final: number;
      discount_percent: number;
    };
  }>;
}

export interface SteamAppDetailsResponse {
  [appId: string]: {
    success: boolean;
    data?: {
      type: string;
      name: string;
      steam_appid: number;
      is_free: boolean;
      detailed_description: string;
      about_the_game: string;
      short_description: string;
      header_image: string;
      capsule_image?: string;
      developers?: string[];
      publishers?: string[];
      price_overview?: {
        final_formatted: string;
      };
      metacritic?: {
        score: number;
        url: string;
      };
      categories?: Array<{ id: number; description: string }>;
      genres?: Array<{ id: string; description: string }>;
      screenshots?: Array<{
        id: number;
        path_thumbnail: string;
        path_full: string;
      }>;
      release_date?: {
        coming_soon: boolean;
        date: string;
      };
    };
  };
}

function stripHtml(html?: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

export class SteamStorefrontScraper implements MetadataProvider {
  public readonly id = 'steam';
  public readonly name = 'Steam Storefront';
  private log = logger.child('SteamStorefrontScraper');
  private client: ExternalServiceClient;

  constructor(client?: ExternalServiceClient) {
    this.client = client || new ExternalServiceClient({ defaultTimeoutMs: 12000 });
  }

  public async searchGame(query: string, _platform?: string): Promise<MetadataSearchResult[]> {
    const cleaned = cleanGameTitle(query);
    this.log.debug(`Searching Steam Store for '${cleaned}' (raw: '${query}')`);

    try {
      const searchUrl = 'https://store.steampowered.com/api/storesearch/';
      const response = await this.client.request<SteamStoreSearchResult>(searchUrl, {
        params: {
          term: cleaned,
          l: 'english',
          cc: 'US'
        }
      });

      const items = response.data?.items || [];
      if (items.length === 0) {
        return [];
      }

      // Return basic search results
      return items.slice(0, 5).map((item) => ({
        id: String(item.id),
        title: item.name,
        platform: 'PC',
        coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900_2x.jpg`,
        bannerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`,
        rawScore: item.metascore ? Number(item.metascore) / 10 : undefined
      }));
    } catch (err) {
      this.log.warn(`Steam store search failed for query '${query}':`, err);
      return [];
    }
  }

  public async identifyGame(identity: { romFilename?: string; platform?: string }): Promise<MetadataSearchResult | null> {
    const name = identity.romFilename;
    if (!name) return null;
    const results = await this.searchGame(name, identity.platform);
    if (results.length > 0) {
      // Get detailed metadata for the first match
      return this.getGameDetails(results[0].id);
    }
    return null;
  }

  public async getGameDetails(appId: string): Promise<MetadataSearchResult | null> {
    this.log.debug(`Fetching Steam app details for AppID: ${appId}`);
    try {
      const detailsUrl = 'https://store.steampowered.com/api/appdetails';
      const response = await this.client.request<SteamAppDetailsResponse>(detailsUrl, {
        params: {
          appids: appId,
          l: 'english'
        }
      });

      const entry = response.data?.[appId];
      if (!entry || !entry.success || !entry.data) {
        return null;
      }

      const d = entry.data;

      // Extract release year from date string (e.g. "16 May, 2011" or "2015")
      let releaseYear: number | undefined;
      if (d.release_date?.date) {
        const yearMatch = d.release_date.date.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) {
          releaseYear = parseInt(yearMatch[1], 10);
        }
      }

      // Convert metacritic score 0-100 to 0-10
      let rawScore: number | undefined;
      if (d.metacritic?.score) {
        rawScore = Math.round((d.metacritic.score / 10) * 10) / 10;
      }

      const genres = d.genres?.map((g) => g.description) || [];
      const screenshots = d.screenshots?.map((s) => s.path_full) || [];

      // High-resolution cover capsule (600x900)
      const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
      const bannerUrl = d.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

      return {
        id: appId,
        title: d.name,
        platform: 'PC',
        releaseYear,
        developer: d.developers?.[0],
        publisher: d.publishers?.[0],
        description: stripHtml(d.short_description || d.about_the_game || d.detailed_description),
        coverUrl,
        bannerUrl,
        screenshotUrls: screenshots.slice(0, 8),
        rawScore,
        genres
      };
    } catch (err) {
      this.log.warn(`Failed to fetch Steam app details for ${appId}:`, err);
      return null;
    }
  }

  public async getArtwork(appId: string, _type?: string): Promise<ArtworkResult[]> {
    return [
      {
        type: 'box_2d',
        url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`
      },
      {
        type: 'banner',
        url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
      }
    ];
  }

  public async getMedia(appId: string, _type?: string): Promise<MediaResult[]> {
    return [
      {
        type: 'video',
        url: `https://store.steampowered.com/video/${appId}`
      }
    ];
  }
}
