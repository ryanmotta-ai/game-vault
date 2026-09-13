import { Game, GameManifest, GamePlatform, LaunchProfile, Emulator, EmulatorAdapterType, LauncherType, LaunchCommand } from '../core/types';

export interface AdapterBuildArgsOptions {
  romPath: string;
  game: Game;
  manifest?: GameManifest | null;
  profile?: LaunchProfile | null;
  emulator: Emulator;
}

export interface EmulatorAdapter {
  id: EmulatorAdapterType;
  name: string;
  supportedPlatforms: GamePlatform[];
  buildArgs(options: AdapterBuildArgsOptions): string[];
  getDefaultExecutableNames(): string[];
  getStandardSearchPaths(): string[];
  validateExecutable(executablePath: string): Promise<{ valid: boolean; version?: string; error?: string }>;
}

export interface GameLauncher {
  type: LauncherType;
  canLaunch(game: Game, manifest?: GameManifest | null): boolean;
  validate(game: Game, manifest?: GameManifest | null, profile?: LaunchProfile | null): Promise<{ valid: boolean; error?: string }>;
  buildLaunchCommand(game: Game, manifest?: GameManifest | null, profile?: LaunchProfile | null): Promise<LaunchCommand>;
}

export interface ActiveProcessSession {
  sessionId: string;
  gameId: string;
  launcherType: LauncherType;
  emulatorId?: string;
  startedAt: string;
  process: any; // ChildProcess
}

export interface LaunchGameOptions {
  gameId: string;
  executablePath?: string;
  arguments?: string[];
}

export interface LaunchResult {
  success: boolean;
  error?: string;
  session?: any;
}
