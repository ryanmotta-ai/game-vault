import { ExternalServiceClient } from '../../integrations/client/ExternalServiceClient';
import { MetadataProvider, MetadataSearchResult, ArtworkResult, MediaResult } from '../../integrations/metadata/MetadataProvider';
import { getCredentialStore } from '../../core/security/CredentialStore';
import { IntegrationConnectionsRepository } from '../../database/repositories/integrationConnectionsRepository';
import { cleanGameTitle } from '../titleSanitizer';
import { logger } from '../../core/logger';

interface IgdbGameItem {
  id: number;
  name: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  rating?: number;
  aggregated_rating?: number;
  cover?: { id: number; image_id: string };
  artworks?: Array<{ id: number; image_id: string }>;
  screenshots?: Array<{ id: number; image_id: string }>;
  genres?: Array<{ id: number; name: string }>;
  involved_companies?: Array<{
    id: number;
    developer?: boolean;
    publisher?: boolean;
    company?: { id: number; name: string };
  }>;
  platforms?: Array<{ id: number; name: string }>;
}

export class IgdbMetadataProvider implements MetadataProvider {
  public readonly id = 'igdb';
  public readonly name = 'IGDB';
  private log = logger.child('IgdbMetadataProvider');
  private client: ExternalServiceClient;
  private cachedAccessToken?: string;
  private tokenExpiresAt = 0;

  constructor(
    private connectionsRepo: IntegrationConnectionsRepository,
    client?: ExternalServiceClient
  ) {
    this.client = client || new ExternalServiceClient({ defaultTimeoutMs: 15000 });
  }

  private async getAuth(): Promise<{ clientId: string; accessToken: string }> {
    const conn = this.connectionsRepo.getByIntegrationId('igdb')[0];
    if (!conn || conn.status !== 'CONNECTED' || !conn.credentialKey) {
      throw new Error('IGDB is not connected. Configure Twitch Developer credentials in Settings -> Integrations.');
    }

    const credStore = getCredentialStore();
    const raw = await credStore.get(conn.credentialKey);
    if (!raw) {
      throw new Error('IGDB credentials missing in secure store.');
    }

    const creds = JSON.parse(raw);
    const clientId = creds.clientId || creds.username;
    const clientSecret = creds.clientSecret || creds.password;

    if (!clientId) {
      throw new Error('IGDB Client ID is required.');
    }

    // If a direct token was provided, use it
    if (creds.token) {
      return { clientId, accessToken: creds.token };
    }

    // Re-use cached token if valid
    const now = Date.now();
    if (this.cachedAccessToken && this.tokenExpiresAt > now + 60000) {
      return { clientId, accessToken: this.cachedAccessToken };
    }

    if (!clientSecret) {
      throw new Error('IGDB Client Secret is required to generate Twitch OAuth token.');
    }

    // Fetch client credentials token from Twitch OAuth
    const tokenUrl = 'https://id.twitch.tv/oauth2/token';
    const resp = await this.client.request<{ access_token: string; expires_in: number }>(tokenUrl, {
      method: 'POST',
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      }
    });

    if (!resp.data?.access_token) {
      throw new Error('Failed to acquire OAuth token from Twitch.');
    }

    this.cachedAccessToken = resp.data.access_token;
    this.tokenExpiresAt = now + (resp.data.expires_in || 3600) * 1000;

    return { clientId, accessToken: this.cachedAccessToken };
  }

  public async searchGame(query: string, _platform?: string): Promise<MetadataSearchResult[]> {
    const cleaned = cleanGameTitle(query);
    this.log.debug(`Searching IGDB for '${cleaned}'`);

    try {
      const { clientId, accessToken } = await this.getAuth();
      const endpoint = 'https://api.igdb.com/v4/games';

      const apicalypseQuery = `
        search "${cleaned.replace(/"/g, '\\"')}";
        fields name, summary, storyline, first_release_date, rating, aggregated_rating,
               cover.image_id, artworks.image_id, screenshots.image_id,
               genres.name, involved_companies.developer, involved_companies.publisher,
               involved_companies.company.name, platforms.name;
        limit 5;
      `.trim();

      const response = await this.client.request<IgdbGameItem[]>(endpoint, {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain'
        },
        body: apicalypseQuery
      });

      const items = response.data || [];
      return items.map((g) => this.mapIgdbToResult(g));
    } catch (err) {
      this.log.warn(`IGDB search failed for '${query}':`, err);
      return [];
    }
  }

  public async identifyGame(identity: { romFilename?: string; platform?: string }): Promise<MetadataSearchResult | null> {
    if (!identity.romFilename) return null;
    const results = await this.searchGame(identity.romFilename, identity.platform);
    return results.length > 0 ? results[0] : null;
  }

  public async getGameDetails(id: string): Promise<MetadataSearchResult | null> {
    try {
      const { clientId, accessToken } = await this.getAuth();
      const endpoint = 'https://api.igdb.com/v4/games';

      const apicalypseQuery = `
        where id = ${id};
        fields name, summary, storyline, first_release_date, rating, aggregated_rating,
               cover.image_id, artworks.image_id, screenshots.image_id,
               genres.name, involved_companies.developer, involved_companies.publisher,
               involved_companies.company.name, platforms.name;
        limit 1;
      `.trim();

      const response = await this.client.request<IgdbGameItem[]>(endpoint, {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain'
        },
        body: apicalypseQuery
      });

      const items = response.data || [];
      return items.length > 0 ? this.mapIgdbToResult(items[0]) : null;
    } catch (err) {
      this.log.warn(`IGDB getGameDetails failed for ID ${id}:`, err);
      return null;
    }
  }

  private mapIgdbToResult(g: IgdbGameItem): MetadataSearchResult {
    let releaseYear: number | undefined;
    if (g.first_release_date) {
      releaseYear = new Date(g.first_release_date * 1000).getFullYear();
    }

    let developer: string | undefined;
    let publisher: string | undefined;

    if (g.involved_companies) {
      for (const comp of g.involved_companies) {
        if (comp.developer && comp.company?.name && !developer) {
          developer = comp.company.name;
        }
        if (comp.publisher && comp.company?.name && !publisher) {
          publisher = comp.company.name;
        }
      }
    }

    const coverUrl = g.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg`
      : undefined;

    const bannerUrl = g.artworks?.[0]?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_1080p/${g.artworks[0].image_id}.jpg`
      : undefined;

    const screenshotUrls = g.screenshots?.map(
      (s) => `https://images.igdb.com/igdb/image/upload/t_1080p/${s.image_id}.jpg`
    ) || [];

    const rawScore = g.aggregated_rating || g.rating
      ? Math.round(((g.aggregated_rating || g.rating)! / 10) * 10) / 10
      : undefined;

    const genres = g.genres?.map((gen) => gen.name) || [];
    const platform = g.platforms?.[0]?.name;

    return {
      id: String(g.id),
      title: g.name,
      platform,
      releaseYear,
      developer,
      publisher,
      description: g.summary || g.storyline,
      coverUrl,
      bannerUrl,
      screenshotUrls: screenshotUrls.slice(0, 8),
      rawScore,
      genres
    };
  }

  public async getArtwork(id: string, _type?: string): Promise<ArtworkResult[]> {
    const details = await this.getGameDetails(id);
    const results: ArtworkResult[] = [];
    if (details?.coverUrl) results.push({ type: 'box_2d', url: details.coverUrl });
    if (details?.bannerUrl) results.push({ type: 'banner', url: details.bannerUrl });
    return results;
  }

  public async getMedia(_id: string, _type?: string): Promise<MediaResult[]> {
    return [];
  }
}
