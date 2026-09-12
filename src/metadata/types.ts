import { GamePlatform } from '../core/types';

export interface GameMetadataScraped {
  title: string;
  slug: string;
  description?: string;
  coverUrl?: string;
  bannerUrl?: string;
  platform: GamePlatform;
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  genres?: string[];
  rating?: number;
}

export interface MetadataSearchQuery {
  title: string;
  platform?: GamePlatform;
  year?: number;
}
