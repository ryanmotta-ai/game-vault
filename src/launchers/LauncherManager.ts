import fs from 'node:fs';
import {
  Game,
  LaunchProfile,
  Emulator,
  GameSession,
  LauncherType,
  GameRunningStateEvent,
  EffectivePlaybackStrategy
} from '../core/types';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameFilesRepository } from '../database/repositories/gameFilesRepository';
import { GameManifestsRepository } from '../database/repositories/gameManifestsRepository';
import { LaunchProfilesRepository } from '../database/repositories/launchProfilesRepository';
import { EmulatorsRepository } from '../database/repositories/emulatorsRepository';
import { GameSessionsRepository } from '../database/repositories/gameSessionsRepository';
import { StorageManager } from '../storage/StorageManager';
import { CacheManager } from '../storage/CacheManager';
import { GameAvailabilityService } from '../catalog/GameAvailabilityService';
import { InstantHydrationService, HydrationProgress } from '../streaming/InstantHydrationService';
import { PlaybackStrategyResolver } from '../streaming/PlaybackStrategyResolver';
import { NativePcLauncher } from './NativePcLauncher';
import { EmulatorLauncher } from './EmulatorLauncher';
import { EmulatorDetectionService } from './EmulatorDetectionService';
import { ProcessMonitor } from './ProcessMonitor';
import { GameLauncher, ActiveProcessSession } from './types';
import { NotFoundError, LauncherError, RomNotFoundError } from '../core/errors/AppError';
import { logger } from '../core/logger';

export interface EffectiveProfileResult {
  profile: LaunchProfile;
  emulator?: Emulator;
  isAutoConfigured: boolean;
  canLaunch: boolean;
  validationError?: string;
}

export class LauncherManager {
  private log = logger.child('LauncherManager');
  private nativeLauncher: NativePcLauncher;
  private emulatorLauncher: EmulatorLauncher;
  private detectionService: EmulatorDetectionService;
  private processMonitor: ProcessMonitor;

  constructor(
    private gamesRepo: GamesRepository,
    private gameManifestsRepo: GameManifestsRepository,
    private launchProfilesRepo: LaunchProfilesRepository,
    private emulatorsRepo: EmulatorsRepository,
    private gameSessionsRepo: GameSessionsRepository,
    private cacheManager?: CacheManager,
    private availabilityService?: GameAvailabilityService,
    private instantHydrationService?: InstantHydrationService,
    private strategyResolver?: PlaybackStrategyResolver,
    private gameFilesRepo?: GameFilesRepository,
    private storageManager?: StorageManager
  ) {
    this.nativeLauncher = new NativePcLauncher();
    this.emulatorLauncher = new EmulatorLauncher(this.emulatorsRepo);
    this.detectionService = new EmulatorDetectionService(
      this.emulatorLauncher.getAllAdapters(),
      this.emulatorsRepo
    );
    this.processMonitor = new ProcessMonitor(this.gameSessionsRepo, this.gamesRepo);
  }

  public getCacheManager(): CacheManager | undefined {
    return this.cacheManager;
  }

  public getProcessMonitor(): ProcessMonitor {
    return this.processMonitor;
  }

  public getEmulatorLauncher(): EmulatorLauncher {
    return this.emulatorLauncher;
  }

  public getDetectionService(): EmulatorDetectionService {
    return this.detectionService;
  }

  public isGameRunning(gameId: string): boolean {
    return this.processMonitor.isGameRunning(gameId);
  }

  public getRunningGames(): string[] {
    return this.processMonitor.getRunningGames();
  }

  public getActiveSession(gameId: string): ActiveProcessSession | undefined {
    return this.processMonitor.getActiveSession(gameId);
  }

  public onRunningStateChange(listener: (event: GameRunningStateEvent) => void): () => void {
    return this.processMonitor.onRunningStateChange(listener);
  }

  public selectLauncher(game: Game, profile?: LaunchProfile | null): GameLauncher {
    if (profile?.launcherType === 'native_pc' || game.platform === 'PC') {
      return this.nativeLauncher;
    }
    return this.emulatorLauncher;
  }

  public async getEffectiveProfile(gameId: string): Promise<EffectiveProfileResult> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found: ${gameId}`);
    }

    const manifest = this.gameManifestsRepo.get(gameId);
    let profile = this.launchProfilesRepo.getByGameId(gameId);
    let isAutoConfigured = false;

    if (!profile) {
      isAutoConfigured = true;
      const launcherType: LauncherType = game.platform === 'PC' ? 'native_pc' : 'emulator';
      let emulatorId: string | undefined;

      if (launcherType === 'emulator') {
        const defaultEmu = this.emulatorLauncher.resolveEmulatorForGame(game, null);
        emulatorId = defaultEmu?.id;
      }

      profile = {
        id: `lp_${game.id}`,
        gameId: game.id,
        launcherType,
        emulatorId,
        fullscreen: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    const emulator = profile.emulatorId ? (this.emulatorsRepo.getById(profile.emulatorId) ?? undefined) : undefined;
    const launcher = this.selectLauncher(game, profile);
    const validation = await launcher.validate(game, manifest, profile);

    return {
      profile,
      emulator,
      isAutoConfigured,
      canLaunch: validation.valid,
      validationError: validation.error
    };
  }

  public async saveProfile(
    profileData: Partial<LaunchProfile> & { gameId: string }
  ): Promise<LaunchProfile> {
    const existing = this.launchProfilesRepo.getByGameId(profileData.gameId);
    const updated: LaunchProfile = {
      id: existing?.id || `lp_${profileData.gameId}`,
      gameId: profileData.gameId,
      launcherType: profileData.launcherType || existing?.launcherType || 'emulator',
      emulatorId: profileData.emulatorId !== undefined ? profileData.emulatorId : existing?.emulatorId,
      executablePath: profileData.executablePath !== undefined ? profileData.executablePath : existing?.executablePath,
      argumentsTemplate: profileData.argumentsTemplate !== undefined ? profileData.argumentsTemplate : existing?.argumentsTemplate,
      workingDirectory: profileData.workingDirectory !== undefined ? profileData.workingDirectory : existing?.workingDirectory,
      fullscreen: profileData.fullscreen !== undefined ? profileData.fullscreen : (existing?.fullscreen ?? true),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.launchProfilesRepo.upsert(updated);
    this.log.info(`Saved launch profile for game ${profileData.gameId}`);
    return updated;
  }

  public async getPlaybackStrategy(gameId: string): Promise<EffectivePlaybackStrategy> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found: ${gameId}`);
    }

    if (!this.strategyResolver) {
      return {
        strategy: game.state === 'READY' ? 'INSTANT_HYDRATION' : 'LOCAL_REQUIRED',
        reason: 'Streaming strategy resolver not configured.',
        isStreamable: false,
        estimatedHydrationTimeMs: 0
      };
    }

    const files = this.gameFilesRepo ? this.gameFilesRepo.getByGameId(gameId) : [];
    const primaryFile = files[0];
    const profile = this.launchProfilesRepo.getByGameId(gameId);
    const provider =
      primaryFile && this.storageManager
        ? this.storageManager.getProvider(primaryFile.storageAccountId)
        : undefined;

    return this.strategyResolver.resolve({
      game,
      gameFile: primaryFile,
      profile,
      provider
    });
  }

  public async hydrateAndLaunch(
    gameId: string,
    onProgress?: (progress: HydrationProgress) => void
  ): Promise<GameSession> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found: ${gameId}`);
    }

    if (game.state !== 'READY') {
      if (!this.instantHydrationService) {
        throw new LauncherError(
          `Cannot hydrate game "${game.title}". Instant hydration service is not configured.`
        );
      }
      await this.instantHydrationService.hydrateGame(gameId, onProgress);
    }

    return this.launchGame(gameId);
  }

  public async launchGame(gameId: string): Promise<GameSession> {
    const game = this.gamesRepo.getById(gameId);
    if (!game) {
      throw new NotFoundError(`Game not found: ${gameId}`);
    }

    if (game.state !== 'READY') {
      // If Instant Hydration service is available, evaluate if this title is eligible
      if (this.instantHydrationService) {
        const strategyResult = await this.getPlaybackStrategy(gameId);
        if (strategyResult.strategy === 'INSTANT_HYDRATION') {
          this.log.info(
            `Game "${game.title}" is in state "${game.state}". Triggering transparent Instant Hydration...`
          );
          await this.instantHydrationService.hydrateGame(gameId);
          return this.launchGame(gameId);
        }
      }

      throw new LauncherError(
        `Cannot launch game "${game.title}". Current state is "${game.state}". Must be READY.`
      );
    }

    // 1. Pre-launch local file validation & reconciliation
    const manifest = this.gameManifestsRepo.get(gameId);
    if (game.installedPath && !fs.existsSync(game.installedPath)) {
      this.log.warn(
        `Installed path for game "${game.title}" (${gameId}) does not exist: "${game.installedPath}". Reconciling game state...`
      );
      if (this.availabilityService) {
        this.availabilityService.recalculate(gameId);
      } else {
        this.gamesRepo.updateState(gameId, 'CLOUD', null);
      }
      throw new RomNotFoundError(game.installedPath);
    }

    // 2. Resolve profile and launcher
    const effective = await this.getEffectiveProfile(gameId);
    const profile = effective.profile;
    const launcher = this.selectLauncher(game, profile);

    // 3. Pre-launch launcher validation
    const validation = await launcher.validate(game, manifest, profile);
    if (!validation.valid) {
      throw new LauncherError(validation.error || 'Pre-launch validation failed.');
    }

    // 4. Build immutable launch command
    const command = await launcher.buildLaunchCommand(game, manifest, profile);

    // 5. Update last accessed timestamp
    this.gamesRepo.updateLastAccessed(game.id);

    // 6. Spawn and monitor process
    return this.processMonitor.launchProcess(
      command,
      game,
      profile.launcherType,
      profile.emulatorId
    );
  }

  public async stopGame(gameId: string): Promise<boolean> {
    return this.processMonitor.stopProcess(gameId);
  }

  public async autoDetectEmulators(customPaths?: string[]): Promise<Emulator[]> {
    return this.detectionService.autoDetectAndPersist(customPaths);
  }

  public shutdown(): void {
    this.processMonitor.shutdown();
  }
}
