import {
  GamePlatform,
  MatchConfidence,
  MetadataSourceStatus,
  MetadataJobStatus,
  MetadataJobPriority,
  GameArtworkType,
  GameMetadata,
  GameMetadataSource,
  GameArtwork,
  GameIdentityQuery,
  MetadataCandidate
} from '../core/types';

export type {
  MatchConfidence,
  MetadataSourceStatus,
  MetadataJobStatus,
  MetadataJobPriority,
  GameArtworkType,
  GameMetadata,
  GameMetadataSource,
  GameArtwork,
  GameIdentityQuery,
  MetadataCandidate
};

export interface GameMetadataScraped {
  title: string;
  slug?: string;
  description?: string;
  coverUrl?: string;
  bannerUrl?: string;
  logoUrl?: string;
  screenshotUrls?: string[];
  platform?: GamePlatform | string;
  releaseYear?: number;
  releaseDate?: string;
  developer?: string;
  publisher?: string;
  genres?: string[];
  rating?: number; // 0.0 - 10.0 scale
  localCoverPath?: string;
  localBannerPath?: string;
  localLogoPath?: string;
  localScreenshotPaths?: string[];
  metadataSource?: string;
  metadataScrapedAt?: string;
}

export interface MetadataSearchQuery {
  title: string;
  platform?: GamePlatform | string;
  year?: number;
  romFilename?: string;
  md5?: string;
  serial?: string;
}

export interface MetadataProgressEvent {
  current: number;
  total: number;
  gameId: string;
  title: string;
  status: 'queued' | 'searching' | 'matched' | 'downloading_media' | 'completed' | 'failed' | 'review_required' | 'skipped';
  source?: string;
  error?: string;
  confidence?: MatchConfidence;
}

export interface ArtworkCacheStats {
  totalFiles: number;
  totalSizeBytes: number;
  coversCount: number;
  bannersCount: number;
  logosCount: number;
  screenshotsCount: number;
}
