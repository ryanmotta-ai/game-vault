import {
  MetadataProvider,
  GameIdentityQuery,
  MetadataSearchResult,
  ArtworkResult,
  MediaResult
} from './MetadataProvider';
import { ExternalServiceClient } from '../client/ExternalServiceClient';
import { getCredentialStore } from '../../core/security/CredentialStore';
import { IntegrationConnectionsRepository } from '../../database/repositories/integrationConnectionsRepository';
import { MetadataPlatformMapper } from '../../metadata/MetadataPlatformMapper';
import { logger } from '../../core/logger';

export class ScreenScraperMetadataProvider implements MetadataProvider {
  public readonly id = 'screenscraper';
  public readonly name = 'ScreenScraper';
  private log = logger.child('ScreenScraperMetadataProvider');
  private client: ExternalServiceClient;
  private rateLimitedUntil = 0;

  constructor(
    private connectionsRepo: IntegrationConnectionsRepository,
    client?: ExternalServiceClient
  ) {
    this.client = client || new ExternalServiceClient({ defaultTimeoutMs: 15000 });
  }

  public isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  public setRateLimitBackoff(seconds: number = 60): void {
    this.rateLimitedUntil = Date.now() + seconds * 1000;
  }

  private async getAuthParams(): Promise<Record<string, string>> {
    const conn = this.connectionsRepo.getByIntegrationId('screenscraper')[0];
    if (!conn || conn.status !== 'CONNECTED' || !conn.credentialKey) {
      throw new Error('ScreenScraper is not connected. Connect ScreenScraper in Settings -> Integrations.');
    }

    const credStore = getCredentialStore();
    const raw = await credStore.get(conn.credentialKey);
    if (!raw) {
      throw new Error('ScreenScraper credentials missing.');
    }

    const creds = JSON.parse(raw);
    const devId = process.env.GAMEVAULT_SCREENSCRAPER_DEV_ID || 'gamevault_community';
    const devPassword = process.env.GAMEVAULT_SCREENSCRAPER_DEV_PASSWORD || '';
    const softName = process.env.GAMEVAULT_SCREENSCRAPER_SOFTNAME || 'GameVault';

    return {
      devid: devId,
      devpassword: devPassword,
      softname: softName,
      output: 'json',
      ssid: creds.username,
      sspassword: creds.password
    };
  }

  private handleRateLimit(error: any): void {
    const status = error?.response?.status || error?.status;
    if (status === 429) {
      const retryAfter = Number(error?.response?.headers?.['retry-after']) || 60;
      this.setRateLimitBackoff(retryAfter);
      this.log.warn(`ScreenScraper rate limit hit (HTTP 429). Pausing requests for ${retryAfter}s.`);
    }
  }

  public async searchGame(query: string, platform?: string): Promise<MetadataSearchResult[]> {
    if (this.isRateLimited()) {
      this.log.warn(`ScreenScraper search skipped: rate limited until ${new Date(this.rateLimitedUntil).toISOString()}`);
      return [];
    }

    this.log.debug(`Searching game metadata: ${query}`);
    try {
      const auth = await this.getAuthParams();
      const endpoint = 'https://www.screenscraper.fr/api2/jeuRecherche.php';
      const params: Record<string, string> = {
        ...auth,
        recherche: query
      };

      if (platform) {
        const sysId = MetadataPlatformMapper.getScreenScraperSystemId(platform);
        if (sysId) {
          params.systemeid = String(sysId);
        }
      }

      const response = await this.client.request<{
        response?: {
          jeux?: Array<{
            id: string | number;
            noms?: Array<{ nom: string; region?: string }>;
            systeme?: { id: string | number; nom: string };
            dates?: Array<{ annee: string | number; region?: string }>;
            developpeur?: { nom: string };
            editeur?: { nom: string };
            synopsis?: Array<{ texte: string; langue?: string }>;
            medias?: Array<{ type: string; url: string; format?: string }>;
          }>;
        };
      }>(endpoint, { params });

      const items = response.data?.response?.jeux || [];
      return items.map((j) => {
        const title = j.noms?.[0]?.nom || query;
        const synopsis = j.synopsis?.[0]?.texte;
        const releaseYear = j.dates?.[0]?.annee ? Number(j.dates[0].annee) : undefined;
        const gameIdStr = String(j.id);

        return {
          id: gameIdStr,
          title,
          platform: j.systeme?.nom,
          releaseYear,
          developer: j.developpeur?.nom,
          publisher: j.editeur?.nom,
          description: synopsis,
          coverUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=box-2D`,
          logoUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=wheel`,
          bannerUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=fanart`,
          screenshotUrls: [`https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=ss`]
        };
      });
    } catch (err) {
      this.handleRateLimit(err);
      this.log.warn(`Metadata search failed for query '${query}':`, err);
      return [];
    }
  }

  public async identifyGame(identity: GameIdentityQuery): Promise<MetadataSearchResult | null> {
    if (this.isRateLimited()) {
      return null;
    }

    try {
      const auth = await this.getAuthParams();
      const endpoint = 'https://www.screenscraper.fr/api2/jeuInfos.php';
      const params: Record<string, string> = { ...auth };

      if (identity.romFilename) params.romnom = identity.romFilename;
      if (identity.crc) params.romcrc = identity.crc;
      if (identity.md5) params.rommd5 = identity.md5;
      if (identity.sha1) params.romsha1 = identity.sha1;

      if (identity.systemId) {
        params.systemeid = String(identity.systemId);
      } else if (identity.normalizedPlatform || identity.platform) {
        const sysId = MetadataPlatformMapper.getScreenScraperSystemId(
          (identity.normalizedPlatform || identity.platform)!
        );
        if (sysId) params.systemeid = String(sysId);
      }

      const response = await this.client.request<{
        response?: {
          jeu?: {
            id: string | number;
            noms?: Array<{ nom: string; region?: string }>;
            systeme?: { id: string | number; nom: string };
            dates?: Array<{ annee: string | number }>;
            developpeur?: { nom: string };
            editeur?: { nom: string };
            synopsis?: Array<{ texte: string }>;
            genres?: Array<{ noms?: Array<{ nom: string }> }>;
          };
        };
      }>(endpoint, { params });

      const jeu = response.data?.response?.jeu;
      if (!jeu) return null;

      const gameIdStr = String(jeu.id);
      const title = jeu.noms?.[0]?.nom || identity.romFilename || identity.title || 'Identified Game';
      const genres = jeu.genres?.map((g) => g.noms?.[0]?.nom).filter((g): g is string => Boolean(g));

      return {
        id: gameIdStr,
        title,
        platform: jeu.systeme?.nom,
        releaseYear: jeu.dates?.[0]?.annee ? Number(jeu.dates[0].annee) : undefined,
        developer: jeu.developpeur?.nom,
        publisher: jeu.editeur?.nom,
        description: jeu.synopsis?.[0]?.texte,
        genres,
        coverUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=box-2D`,
        logoUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=wheel`,
        bannerUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=fanart`,
        screenshotUrls: [`https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${gameIdStr}&media=ss`]
      };
    } catch (err) {
      this.handleRateLimit(err);
      return null;
    }
  }

  public async getGameDetails(id: string): Promise<MetadataSearchResult | null> {
    if (this.isRateLimited()) {
      return null;
    }

    try {
      const auth = await this.getAuthParams();
      const endpoint = 'https://www.screenscraper.fr/api2/jeuInfos.php';
      const response = await this.client.request<{
        response?: {
          jeu?: {
            id: string | number;
            noms?: Array<{ nom: string }>;
            systeme?: { nom: string };
            dates?: Array<{ annee: string | number }>;
            developpeur?: { nom: string };
            editeur?: { nom: string };
            synopsis?: Array<{ texte: string }>;
            genres?: Array<{ noms?: Array<{ nom: string }> }>;
          };
        };
      }>(endpoint, { params: { ...auth, gameid: id } });

      const jeu = response.data?.response?.jeu;
      if (!jeu) return null;

      const genres = jeu.genres?.map((g) => g.noms?.[0]?.nom).filter((g): g is string => Boolean(g));

      return {
        id: String(jeu.id),
        title: jeu.noms?.[0]?.nom || id,
        platform: jeu.systeme?.nom,
        releaseYear: jeu.dates?.[0]?.annee ? Number(jeu.dates[0].annee) : undefined,
        developer: jeu.developpeur?.nom,
        publisher: jeu.editeur?.nom,
        description: jeu.synopsis?.[0]?.texte,
        genres,
        coverUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=box-2D`,
        logoUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=wheel`,
        bannerUrl: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=fanart`,
        screenshotUrls: [`https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=ss`]
      };
    } catch (err) {
      this.handleRateLimit(err);
      return null;
    }
  }

  public async getArtwork(id: string, _type?: string): Promise<ArtworkResult[]> {
    return [
      {
        type: 'box_2d',
        url: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=box-2D`
      },
      {
        type: 'wheel',
        url: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=wheel`
      },
      {
        type: 'fanart',
        url: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=fanart`
      },
      {
        type: 'screenshot',
        url: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=ss`
      }
    ];
  }

  public async getMedia(id: string, _type?: string): Promise<MediaResult[]> {
    return [
      {
        type: 'video',
        url: `https://media.screenscraper.fr/api2/mediaJeu.php?gameid=${id}&media=video`
      }
    ];
  }
}
