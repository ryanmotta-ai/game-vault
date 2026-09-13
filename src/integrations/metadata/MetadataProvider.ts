export interface GameIdentityQuery {
  gameId?: string;
  title?: string;
  cleanTitle?: string;
  romFilename?: string;
  crc?: string;
  md5?: string;
  sha1?: string;
  systemId?: string | number;
  platform?: string;
  normalizedPlatform?: string;
  serial?: string;
  discNumber?: number;
  releaseYearHint?: number;
  region?: string;
}

export interface MetadataSearchResult {
  id: string;
  title: string;
  platform?: string;
  releaseYear?: number;
  releaseDate?: string;
  developer?: string;
  publisher?: string;
  description?: string;
  coverUrl?: string;
  bannerUrl?: string;
  logoUrl?: string;
  screenshotUrls?: string[];
  rawScore?: number;
  genres?: string[];
  region?: string;
}

export interface ArtworkResult {
  type: 'box_2d' | 'box_3d' | 'wheel' | 'screenshot' | 'banner' | 'background' | 'fanart' | 'logo' | string;
  url: string;
  width?: number;
  height?: number;
  region?: string;
}

export interface MediaResult {
  type: 'video' | 'manual' | 'soundtrack';
  url: string;
  format?: string;
}

export interface MetadataProvider {
  readonly id: string;
  readonly name: string;

  searchGame(query: string, platform?: string): Promise<MetadataSearchResult[]>;
  identifyGame(identity: GameIdentityQuery): Promise<MetadataSearchResult | null>;
  getGameDetails(id: string): Promise<MetadataSearchResult | null>;
  getArtwork(id: string, type?: string): Promise<ArtworkResult[]>;
  getMedia(id: string, type?: string): Promise<MediaResult[]>;
  isRateLimited?(): boolean;
}
