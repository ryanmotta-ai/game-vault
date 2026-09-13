import path from 'node:path';
import { BaseEmulatorAdapter } from './EmulatorAdapter';
import { AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';

export class DolphinAdapter extends BaseEmulatorAdapter {
  id: EmulatorAdapterType = 'dolphin';
  name = 'Dolphin (GameCube & Wii)';
  supportedPlatforms: GamePlatform[] = ['GameCube', 'Wii'];

  public getDefaultExecutableNames(): string[] {
    return ['Dolphin.exe', 'dolphin-emu.exe', 'dolphin-emu', 'dolphin'];
  }

  public getStandardSearchPaths(): string[] {
    const paths: string[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];

    paths.push(path.join(programFiles, 'Dolphin'));
    paths.push(path.join(programFiles, 'Dolphin-x64'));
    paths.push(path.join(programFilesX86, 'Dolphin'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'Dolphin'));
      paths.push(path.join(localAppData, 'Dolphin'));
    }
    paths.push('C:\\Emulators\\Dolphin');
    paths.push('D:\\Emulators\\Dolphin');

    return paths;
  }

  public buildArgs(options: AdapterBuildArgsOptions): string[] {
    const args: string[] = ['-b'];

    const isFullscreen = options.profile?.fullscreen !== false;
    if (isFullscreen) {
      if (options.emulator.fullscreenArgs) {
        args.push(...options.emulator.fullscreenArgs.trim().split(/\s+/).filter(Boolean));
      } else {
        args.push('-f');
      }
    }

    this.appendCustomArgs(args, options);

    args.push('-e', options.romPath);

    return args;
  }
}
