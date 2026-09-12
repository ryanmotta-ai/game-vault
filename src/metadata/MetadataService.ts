import { GameMetadataScraped, MetadataSearchQuery } from './types';
import { logger } from '../core/logger';
import { NotImplementedError } from '../core/errors/AppError';

export class MetadataService {
  private log = logger.child('MetadataService');

  public async fetchMetadata(query: MetadataSearchQuery): Promise<GameMetadataScraped | null> {
    this.log.info(`Querying game metadata for '${query.title}'`);
    // In Phase 5: IGDB API integration / Steam storefront scraper / local fallback
    throw new NotImplementedError('MetadataService.fetchMetadata (Phase 5)');
  }
}
