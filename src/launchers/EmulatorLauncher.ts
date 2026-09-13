import fs from 'node:fs';
import path from 'node:path';
import { GameLauncher, EmulatorAdapter } from './types';
import { Game, GameManifest, LaunchProfile, Emulator, LauncherType, LaunchCommand, GamePlatform } from '../core/types';
import { EmulatorsRepository } from '../database/repositories/emulatorsRepository';
import { PCSX2Adapter, DuckStationAdapter, DolphinAdapter, PPSSPPAdapter, RetroArchAdapter } from './adapters';
import { EmulatorNotFoundError, RomNotFoundError, ExecutableInaccessibleError } from '../core/errors/AppError';

export class EmulatorLauncher implements GameLauncher {
  public readonly type: LauncherType = 'emulator';
  private adapters: Map<string, EmulatorAdapter> = new Map();

  constructor(private emulatorsRepo: EmulatorsRepository) {
    this.registerAdapter(new PCSX2Adapter());
    this.registerAdapter(new DuckStationAdapter());
    this.registerAdapter(new DolphinAdapter());
    this.registerAdapter(new PPSSPPAdapter());
    this.registerAdapter(new RetroArchAdapter());
  }

  public registerAdapter(adapter: EmulatorAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public getAdapter(adapterType: string): EmulatorAdapter | undefined {
    return this.adapters.get(adapterType);
  }

  public getAllAdapters(): EmulatorAdapter[] {
    return Array.from(this.adapters.values());
  }

  public getAdapterForPlatform(platform: GamePlatform): EmulatorAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.supportedPlatforms.includes(platform)) {
        return adapter;
      }
    }
    return undefined;
  }

  public canLaunch(game: Game, _manifest?: GameManifest | null): boolean {
    return game.platform !== 'PC';
  }

  public resolveEmulatorForGame(game: Game, profile?: LaunchProfile | null): Emulator | null {
    if (profile?.emulatorId) {
      const emu = this.emulatorsRepo.getById(profile.emulatorId);
      if (emu && emu.enabled) return emu;
    }

    // Lookup emulators configured for this platform
    const candidates = this.emulatorsRepo.getByPlatform(game.platform);
    // Prefer detected & enabled emulators
    const active = candidates.find((e) => e.enabled && e.detected && fs.existsSync(e.executablePath));
    if (active) return active;

    // Fallback: any enabled emulator for this platform
    const anyEnabled = candidates.find((e) => e.enabled);
    return anyEnabled || null;
  }

  public resolveRomPath(game: Game, manifest?: GameManifest | null): string | null {
    if (manifest?.primaryExecutableOrRom && game.installedPath) {
      const candidate = path.isAbsolute(manifest.primaryExecutableOrRom)
        ? manifest.primaryExecutableOrRom
        : path.join(game.installedPath, manifest.primaryExecutableOrRom);
      if (fs.existsSync(candidate)) return candidate;
    }

    if (game.installedPath) {
      if (fs.existsSync(game.installedPath)) {
        const stat = fs.statSync(game.installedPath);
        if (stat.isFile()) return game.installedPath;

        // If directory, search for standard ROM extensions
        if (stat.isDirectory()) {
          try {
            const files = fs.readdirSync(game.installedPath);
            // Check for cue, gdi, iso, chd, etc.
            const primaryExts = ['.cue', '.gdi', '.iso', '.chd', '.rvz', '.wbfs', '.nds', '.3ds', '.z64', '.gba', '.sfc', '.nes'];
            for (const ext of primaryExts) {
              const match = files.find((f) => f.toLowerCase().endsWith(ext));
              if (match) return path.join(game.installedPath, match);
            }
          } catch {
            // Ignore
          }
        }
      }
    }

    return null;
  }

  public async validate(
    game: Game,
    manifest?: GameManifest | null,
    profile?: LaunchProfile | null
  ): Promise<{ valid: boolean; error?: string }> {
    if (game.state !== 'READY') {
      return { valid: false, error: `Game is not ready to play (State: ${game.state}).` };
    }

    const romPath = this.resolveRomPath(game, manifest);
    if (!romPath || !fs.existsSync(romPath)) {
      return { valid: false, error: `Playable ROM or disk image not found on disk: "${romPath || 'unknown'}"` };
    }

    const emulator = this.resolveEmulatorForGame(game, profile);
    if (!emulator) {
      return {
        valid: false,
        error: `No emulator configured for platform "${game.platform}". Please configure one in Settings.`
      };
    }

    if (!fs.existsSync(emulator.executablePath)) {
      return {
        valid: false,
        error: `Configured emulator executable does not exist at "${emulator.executablePath}".`
      };
    }

    return { valid: true };
  }

  public async buildLaunchCommand(
    game: Game,
    manifest?: GameManifest | null,
    profile?: LaunchProfile | null
  ): Promise<LaunchCommand> {
    const romPath = this.resolveRomPath(game, manifest);
    if (!romPath || !fs.existsSync(romPath)) {
      throw new RomNotFoundError(romPath || `${game.title} ROM`);
    }

    const emulator = this.resolveEmulatorForGame(game, profile);
    if (!emulator) {
      throw new EmulatorNotFoundError(game.platform);
    }

    if (!fs.existsSync(emulator.executablePath)) {
      throw new ExecutableInaccessibleError(emulator.executablePath);
    }

    const adapter =
      (emulator.adapterType ? this.adapters.get(emulator.adapterType) : undefined) ||
      this.getAdapterForPlatform(game.platform);
    if (!adapter) {
      throw new EmulatorNotFoundError(
        `${game.platform} (No adapter registered for adapterType: ${emulator.adapterType || 'unknown'})`
      );
    }

    const args = adapter.buildArgs({
      romPath,
      game,
      manifest,
      profile,
      emulator
    });

    const cwd = emulator.workingDirectory && fs.existsSync(emulator.workingDirectory)
      ? emulator.workingDirectory
      : path.dirname(emulator.executablePath);

    return {
      executable: emulator.executablePath,
      args,
      cwd
    };
  }
}
