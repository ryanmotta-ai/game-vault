import fs from 'node:fs';
import path from 'node:path';
import { GameLauncher } from './types';
import { Game, GameManifest, LaunchProfile, LauncherType, LaunchCommand } from '../core/types';
import { RomNotFoundError, ExecutableInaccessibleError } from '../core/errors/AppError';

export class NativePcLauncher implements GameLauncher {
  public readonly type: LauncherType = 'native_pc';

  public canLaunch(game: Game, _manifest?: GameManifest | null): boolean {
    return game.platform === 'PC';
  }

  public async validate(
    game: Game,
    manifest?: GameManifest | null,
    profile?: LaunchProfile | null
  ): Promise<{ valid: boolean; error?: string }> {
    if (game.state !== 'READY') {
      return { valid: false, error: `Game is not ready to play (State: ${game.state}).` };
    }

    const exePath = this.resolveExecutablePath(game, manifest, profile);
    if (!exePath || !fs.existsSync(exePath)) {
      return { valid: false, error: `Executable not found on disk: "${exePath || 'unknown'}"` };
    }

    try {
      const stat = fs.statSync(exePath);
      if (!stat.isFile()) {
        return { valid: false, error: `Path is not a regular file: "${exePath}"` };
      }
    } catch (err: any) {
      return { valid: false, error: err.message || 'Cannot access executable.' };
    }

    return { valid: true };
  }

  public async buildLaunchCommand(
    game: Game,
    manifest?: GameManifest | null,
    profile?: LaunchProfile | null
  ): Promise<LaunchCommand> {
    const exePath = this.resolveExecutablePath(game, manifest, profile);
    if (!exePath || !fs.existsSync(exePath)) {
      throw new RomNotFoundError(exePath || 'PC Executable');
    }

    const stat = fs.statSync(exePath);
    if (!stat.isFile()) {
      throw new ExecutableInaccessibleError(exePath);
    }

    const cwd = profile?.workingDirectory && fs.existsSync(profile.workingDirectory)
      ? profile.workingDirectory
      : path.dirname(exePath);

    const args: string[] = [];
    if (profile?.argumentsTemplate) {
      args.push(...profile.argumentsTemplate.trim().split(/\s+/).filter(Boolean));
    }

    return {
      executable: exePath,
      args,
      cwd
    };
  }

  public resolveExecutablePath(
    game: Game,
    manifest?: GameManifest | null,
    profile?: LaunchProfile | null
  ): string | null {
    if (profile?.executablePath && fs.existsSync(profile.executablePath)) {
      return profile.executablePath;
    }

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

        // If directory, search for primary executable or matching game name
        if (stat.isDirectory()) {
          try {
            const files = fs.readdirSync(game.installedPath);
            const exes = files.filter((f) => f.toLowerCase().endsWith('.exe'));
            if (exes.length > 0) {
              const matched = exes.find((e) => e.toLowerCase().includes(game.slug.toLowerCase())) || exes[0];
              return path.join(game.installedPath, matched);
            }
          } catch {
            // Ignore
          }
        }
      }
    }

    return null;
  }
}
