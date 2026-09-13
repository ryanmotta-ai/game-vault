import path from 'node:path';
import { BaseEmulatorAdapter } from './EmulatorAdapter';
import { AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';

export class DuckStationAdapter extends BaseEmulatorAdapter {
  id: EmulatorAdapterType = 'duckstation';
  name = 'DuckStation (PlayStation)';
  supportedPlatforms: GamePlatform[] = ['PlayStation'];

  public getDefaultExecutableNames(): string[] {
    return [
      'duckstation-qt-x64-ReleaseLTCG.exe',
      'duckstation-qt.exe',
      'duckstation-nogui.exe',
      'duckstation.exe',
      'duckstation'
    ];
  }

  public getStandardSearchPaths(): string[] {
    const paths: string[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];

    paths.push(path.join(programFiles, 'DuckStation'));
    paths.push(path.join(programFilesX86, 'DuckStation'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'DuckStation'));
      paths.push(path.join(localAppData, 'DuckStation'));
    }
    paths.push('C:\\Emulators\\DuckStation');
    paths.push('D:\\Emulators\\DuckStation');

    return paths;
  }

  public buildArgs(options: AdapterBuildArgsOptions): string[] {
    const args: string[] = ['-batch'];

    const isFullscreen = options.profile?.fullscreen !== false;
    if (isFullscreen) {
      if (options.emulator.fullscreenArgs) {
        args.push(...options.emulator.fullscreenArgs.trim().split(/\s+/).filter(Boolean));
      } else {
        args.push('-fullscreen');
      }
    }

    this.appendCustomArgs(args, options);

    args.push('--', options.romPath);

    return args;
  }
}
