import {
  Game,
  GameManifest,
  GameFile,
  LaunchProfile,
  NetworkQuality,
  EffectivePlaybackStrategy,
  GamePlatform
} from '../core/types';
import { StorageProvider } from '../providers/StorageProvider';

export interface StrategyResolverContext {
  game: Game;
  manifest?: GameManifest | null;
  gameFile?: GameFile | null;
  profile?: LaunchProfile | null;
  provider?: StorageProvider | null;
  networkQuality?: NetworkQuality;
  hydrationLimitBytes?: number;
}

export class PlaybackStrategyResolver {
  private static readonly CONSERVATIVE_HYDRATION_PLATFORMS: ReadonlySet<GamePlatform> = new Set([
    'NES',
    'SNES',
    'Game Boy',
    'Game Boy Color',
    'Game Boy Advance',
    'Nintendo 64',
    'Nintendo DS',
    'Retro'
  ]);

  private static readonly PROGRESSIVE_CANDIDATE_PLATFORMS: ReadonlySet<GamePlatform> = new Set([
    'PlayStation'
  ]);

  private defaultHydrationLimitBytes: number;

  constructor(defaultHydrationLimitBytes = 128 * 1024 * 1024) {
    this.defaultHydrationLimitBytes = defaultHydrationLimitBytes;
  }

  public resolve(context: StrategyResolverContext): EffectivePlaybackStrategy {
    const {
      game,
      profile,
      provider,
      networkQuality = 'GOOD',
      hydrationLimitBytes = this.defaultHydrationLimitBytes
    } = context;

    // 1. If already locally READY, play immediately
    if (game.state === 'READY') {
      return {
        strategy: 'INSTANT_HYDRATION',
        reason: 'Game is already fully prepared in local cache.',
        isStreamable: false,
        estimatedHydrationTimeMs: 0
      };
    }

    // 2. User preference: Always Local
    if (profile?.playbackMode === 'always_local') {
      return {
        strategy: 'LOCAL_REQUIRED',
        reason: 'User profile preference is set to Always Local.',
        isStreamable: false
      };
    }

    // 3. Check file extension / format
    const filename = context.gameFile?.filename || game.title;
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    const isChdOrIso = ext === '.chd' || ext === '.iso' || ext === '.pbp';

    // 4. Check network quality
    if (networkQuality === 'POOR') {
      // On poor network, only allow very small ROMs under 16 MB for instant hydration
      if (game.sizeBytes <= 16 * 1024 * 1024) {
        return {
          strategy: 'INSTANT_HYDRATION',
          reason: 'Very small ROM eligible for instant hydration despite POOR network.',
          estimatedHydrationTimeMs: Math.round((game.sizeBytes / (200 * 1024)) * 1000)
        };
      }
      return {
        strategy: 'LOCAL_REQUIRED',
        reason: 'Network quality is POOR; full local download required to prevent gameplay stalls.'
      };
    }

    // 5. Tier 1: Conservative Instant Hydration
    const isHydrationPlatform = PlaybackStrategyResolver.CONSERVATIVE_HYDRATION_PLATFORMS.has(game.platform);
    if (isHydrationPlatform && game.sizeBytes <= hydrationLimitBytes) {
      const estimatedSpeed = networkQuality === 'EXCELLENT' ? 6 * 1024 * 1024 : networkQuality === 'GOOD' ? 2 * 1024 * 1024 : 500 * 1024;
      return {
        strategy: 'INSTANT_HYDRATION',
        reason: `Title fits within Instant Hydration threshold (${Math.round(hydrationLimitBytes / (1024 * 1024))} MB).`,
        estimatedHydrationTimeMs: Math.round((game.sizeBytes / estimatedSpeed) * 1000),
        isStreamable: false
      };
    }

    // 6. Check provider range support for progressive play
    const supportsRange = provider ? (provider.supportsRangeReads ?? Boolean(provider.readRange)) : true;
    if (!supportsRange) {
      return {
        strategy: 'LOCAL_REQUIRED',
        reason: 'Storage provider does not support HTTP range reads required for streaming.'
      };
    }

    // 7. Tier 2: Progressive Play (PS1 Candidate)
    const isProgressivePlatform = PlaybackStrategyResolver.PROGRESSIVE_CANDIDATE_PLATFORMS.has(game.platform);
    if (isProgressivePlatform && isChdOrIso && (networkQuality === 'GOOD' || networkQuality === 'EXCELLENT' || networkQuality === 'FAIR')) {
      return {
        strategy: 'PROGRESSIVE_PLAY',
        reason: 'PlayStation 1 consolidated image suitable for progressive block streaming.',
        isStreamable: true,
        estimatedHydrationTimeMs: 4000 // Estimated bootstrap pre-buffer time
      };
    }

    // 8. Tier 3: Local Required (PS2, GameCube, Wii, Switch, PC, or non-streamable multi-file format)
    return {
      strategy: 'LOCAL_REQUIRED',
      reason: `Platform "${game.platform}" or format requires full local disk preparation.`,
      isStreamable: false
    };
  }
}
