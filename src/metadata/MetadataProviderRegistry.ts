import { MetadataProvider, MetadataSearchResult } from '../integrations/metadata/MetadataProvider';
import { IntegrationManager } from '../integrations/IntegrationManager';
import { MetadataRequestCache } from './MetadataRequestCache';
import { MetadataCandidateScorer } from './MetadataCandidateScorer';
import { GameIdentityQuery, MetadataCandidate } from './types';
import { logger } from '../core/logger';

export interface ProviderRegistryOptions {
  integrationManager?: IntegrationManager;
  requestCache?: MetadataRequestCache;
}

export class MetadataProviderRegistry {
  private log = logger.child('MetadataProviderRegistry');
  private providers = new Map<string, MetadataProvider>();
  private integrationManager?: IntegrationManager;
  private requestCache: MetadataRequestCache;

  constructor(options?: ProviderRegistryOptions) {
    this.integrationManager = options?.integrationManager;
    this.requestCache = options?.requestCache || new MetadataRequestCache();
  }

  public setIntegrationManager(integrationManager: IntegrationManager): void {
    this.integrationManager = integrationManager;
  }

  public getRequestCache(): MetadataRequestCache {
    return this.requestCache;
  }

  public registerProvider(provider: MetadataProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
    this.log.debug(`Registered metadata provider: ${provider.id} (${provider.name})`);
  }

  public unregisterProvider(id: string): boolean {
    return this.providers.delete(id.toLowerCase());
  }

  public getProvider(id: string): MetadataProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  public getAllProviders(): MetadataProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Returns active, usable providers.
   * If IntegrationManager is connected, filters by active 'METADATA_SEARCH' connections.
   * Otherwise, returns all registered providers (e.g. for offline/unit test execution).
   */
  public getAvailableProviders(): MetadataProvider[] {
    if (!this.integrationManager) {
      return this.getAllProviders();
    }

    try {
      const activeConnections = this.integrationManager.getConnectionsWithCapability('METADATA_SEARCH');
      const activeIntegrationIds = new Set(activeConnections.map((c) => c.integrationId.toLowerCase()));

      const available: MetadataProvider[] = [];
      for (const [id, provider] of this.providers.entries()) {
        if (activeIntegrationIds.has(id)) {
          available.push(provider);
        }
      }

      // If no integration connections match but providers were registered explicitly, fallback to registered providers
      return available.length > 0 ? available : this.getAllProviders();
    } catch (err) {
      this.log.warn('Failed to query IntegrationManager for available metadata providers:', err);
      return this.getAllProviders();
    }
  }

  /**
   * Gets the preferred provider if available, or falls back to the first available provider.
   */
  public getPreferredProvider(preferredId?: string): MetadataProvider | null {
    const available = this.getAvailableProviders();
    if (available.length === 0) return null;

    if (preferredId) {
      const match = available.find((p) => p.id.toLowerCase() === preferredId.toLowerCase());
      if (match) return match;
    }

    return available[0];
  }

  /**
   * Searches metadata across providers for a given query, leveraging the request cache
   * and scoring candidates deterministically.
   */
  public async searchCandidates(
    identity: GameIdentityQuery,
    preferredProviderId?: string
  ): Promise<MetadataCandidate[]> {
    const providers = this.getAvailableProviders();
    if (providers.length === 0) {
      this.log.warn('No metadata providers available for search');
      return [];
    }

    // Sort providers: preferred provider first
    const sortedProviders = [...providers].sort((a, b) => {
      if (preferredProviderId) {
        if (a.id.toLowerCase() === preferredProviderId.toLowerCase()) return -1;
        if (b.id.toLowerCase() === preferredProviderId.toLowerCase()) return 1;
      }
      return 0;
    });

    const allCandidates: MetadataCandidate[] = [];

    for (const provider of sortedProviders) {
      // Check if provider is rate-limited
      if (provider.isRateLimited && provider.isRateLimited()) {
        this.log.debug(`Skipping provider ${provider.id} (rate limited)`);
        continue;
      }

      const cacheKey = this.requestCache.generateKey(provider.id, 'search', {
        title: identity.cleanTitle || identity.title,
        platform: identity.normalizedPlatform || identity.platform,
        romFilename: identity.filename || identity.romFilename
      });

      // Check negative cache
      if (this.requestCache.isNegative(cacheKey)) {
        this.log.debug(`Query '${identity.cleanTitle}' is in negative cache for ${provider.id}`);
        continue;
      }

      // Check memory cache
      const cached = this.requestCache.get<MetadataCandidate[]>(cacheKey);
      if (cached) {
        allCandidates.push(...cached);
        continue;
      }

      try {
        let results: MetadataSearchResult[] = [];

        // 1. Try identification by hash/filename/serial first if available
        if (identity.filename || identity.md5 || identity.sha1 || identity.serial || identity.crc) {
          const directMatch = await provider.identifyGame({
            romFilename: identity.filename || identity.romFilename,
            crc: identity.crc,
            md5: identity.md5,
            sha1: identity.sha1,
            serial: identity.serial,
            systemId: identity.systemId,
            platform: identity.platform,
            normalizedPlatform: identity.normalizedPlatform,
            title: identity.cleanTitle || identity.title
          });

          if (directMatch) {
            results.push(directMatch);
          }
        }

        // 2. If no direct hash match, perform textual title search
        if (results.length === 0 && (identity.cleanTitle || identity.title)) {
          const searchTerm = identity.cleanTitle || identity.title;
          const searchResults = await provider.searchGame(
            searchTerm,
            identity.normalizedPlatform || identity.platform
          );
          if (searchResults && searchResults.length > 0) {
            results.push(...searchResults);
          }
        }

        if (results.length === 0) {
          // Negative cache for 24 hours
          this.requestCache.setNegative(cacheKey);
          continue;
        }

        // Convert search results to scored candidates
        const providerCandidates: MetadataCandidate[] = [];
        for (const res of results) {
          // Fetch full details if needed and artwork if missing
          let details: MetadataSearchResult = res;
          if (!res.description || !res.coverUrl) {
            try {
              const full = await provider.getGameDetails(res.id);
              if (full) details = { ...res, ...full };
            } catch {
              // Ignore detail fetch errors
            }
          }

          const candidate = MetadataCandidateScorer.scoreCandidate(identity, {
            provider: provider.id,
            providerGameId: details.id,
            title: details.title,
            platform: details.platform,
            releaseDate: details.releaseDate,
            releaseYear: details.releaseYear,
            region: details.region,
            developer: details.developer,
            publisher: details.publisher,
            description: details.description,
            genres: details.genres,
            rating: details.rawScore,
            coverUrl: details.coverUrl,
            logoUrl: details.logoUrl,
            backgroundUrl: details.bannerUrl,
            screenshotUrls: details.screenshotUrls
          });

          providerCandidates.push(candidate);
        }

        this.requestCache.set(cacheKey, providerCandidates);
        allCandidates.push(...providerCandidates);
      } catch (err) {
        this.log.warn(`Error querying provider ${provider.id}:`, err);
      }
    }

    // Sort all combined candidates by score descending
    allCandidates.sort((a, b) => b.totalScore - a.totalScore);
    return allCandidates;
  }
}
