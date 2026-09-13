import path from 'node:path';
import fs from 'node:fs';
import { BaseEmulatorAdapter } from './EmulatorAdapter';
import { RetroArchCoreRegistry } from './RetroArchCoreRegistry';
import { AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';
import { CoreNotFoundError } from '../../core/errors/AppError';

export class RetroArchAdapter extends BaseEmulatorAdapter {
  id: EmulatorAdapterType = 'retroarch';
  name = 'RetroArch (Multi-System Libretro)';
  supportedPlatforms: GamePlatform[] = [
    'NES',
    'SNES',
    'Game Boy',
    'Game Boy Color',
    'Game Boy Advance',
    'Nintendo 64'
  ];

  public getDefaultExecutableNames(): string[] {
    return ['retroarch.exe', 'retroarch'];
  }

  public getStandardSearchPaths(): string[] {
    const paths: string[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];
    const appData = process.env['APPDATA'];

    paths.push(path.join(programFiles, 'RetroArch'));
    paths.push(path.join(programFiles, 'RetroArch-Win64'));
    paths.push(path.join(programFilesX86, 'RetroArch'));
    if (appData) {
      paths.push(path.join(appData, 'RetroArch'));
    }
    if (localAppData) {
      paths.push(path.join(localAppData, 'RetroArch'));
    }
    paths.push('C:\\Emulators\\RetroArch');
    paths.push('D:\\Emulators\\RetroArch');

    return paths;
  }

  public resolveCoresDirectory(options: AdapterBuildArgsOptions): string {
    if (options.emulator.workingDirectory && fs.existsSync(options.emulator.workingDirectory)) {
      const customCores = path.join(options.emulator.workingDirectory, 'cores');
      if (fs.existsSync(customCores)) return customCores;
    }

    const exeDir = path.dirname(options.emulator.executablePath);
    const exeCores = path.join(exeDir, 'cores');
    if (fs.existsSync(exeCores)) return exeCores;

    const appData = process.env['APPDATA'];
    if (appData) {
      const appDataCores = path.join(appData, 'RetroArch', 'cores');
      if (fs.existsSync(appDataCores)) return appDataCores;
    }

    return exeCores; // Fallback even if not yet existing
  }

  public buildArgs(options: AdapterBuildArgsOptions): string[] {
    const args: string[] = [];

    // Resolve Libretro Core for the platform
    const coresDir = this.resolveCoresDirectory(options);
    const resolvedCore = RetroArchCoreRegistry.resolveCore(options.game.platform, coresDir);

    if (!resolvedCore) {
      throw new CoreNotFoundError(
        `${options.game.platform} (Expected cores directory: "${coresDir}")`
      );
    }

    args.push('-L', resolvedCore.corePath);

    // Fullscreen flag
    const isFullscreen = options.profile?.fullscreen !== false;
    if (isFullscreen) {
      if (options.emulator.fullscreenArgs) {
        args.push(...options.emulator.fullscreenArgs.trim().split(/\s+/).filter(Boolean));
      } else {
        args.push('-f');
      }
    }

    this.appendCustomArgs(args, options);

    args.push(options.romPath);

    return args;
  }
}
