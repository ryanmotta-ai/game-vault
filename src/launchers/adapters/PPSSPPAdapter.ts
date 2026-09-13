import path from 'node:path';
import { BaseEmulatorAdapter } from './EmulatorAdapter';
import { AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';

export class PPSSPPAdapter extends BaseEmulatorAdapter {
  id: EmulatorAdapterType = 'ppsspp';
  name = 'PPSSPP (PlayStation Portable)';
  supportedPlatforms: GamePlatform[] = ['PSP'];

  public getDefaultExecutableNames(): string[] {
    return [
      'PPSSPPWindows64.exe',
      'PPSSPPWindows.exe',
      'PPSSPPSDL.exe',
      'ppsspp.exe',
      'ppsspp'
    ];
  }

  public getStandardSearchPaths(): string[] {
    const paths: string[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];

    paths.push(path.join(programFiles, 'PPSSPP'));
    paths.push(path.join(programFilesX86, 'PPSSPP'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'PPSSPP'));
      paths.push(path.join(localAppData, 'PPSSPP'));
    }
    paths.push('C:\\Emulators\\PPSSPP');
    paths.push('D:\\Emulators\\PPSSPP');

    return paths;
  }

  public buildArgs(options: AdapterBuildArgsOptions): string[] {
    const args: string[] = [];

    const isFullscreen = options.profile?.fullscreen !== false;
    if (isFullscreen) {
      if (options.emulator.fullscreenArgs) {
        args.push(...options.emulator.fullscreenArgs.trim().split(/\s+/).filter(Boolean));
      } else {
        args.push('--fullscreen');
      }
    }

    this.appendCustomArgs(args, options);

    args.push(options.romPath);

    return args;
  }
}
