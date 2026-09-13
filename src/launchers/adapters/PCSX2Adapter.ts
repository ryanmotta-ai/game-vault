import path from 'node:path';
import { BaseEmulatorAdapter } from './EmulatorAdapter';
import { AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';

export class PCSX2Adapter extends BaseEmulatorAdapter {
  id: EmulatorAdapterType = 'pcsx2';
  name = 'PCSX2 (PlayStation 2)';
  supportedPlatforms: GamePlatform[] = ['PlayStation 2'];

  public getDefaultExecutableNames(): string[] {
    return ['pcsx2-qt.exe', 'pcsx2.exe', 'pcsx2-qt', 'pcsx2'];
  }

  public getStandardSearchPaths(): string[] {
    const paths: string[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];

    paths.push(path.join(programFiles, 'PCSX2'));
    paths.push(path.join(programFilesX86, 'PCSX2'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'PCSX2'));
    }
    paths.push('C:\\Emulators\\PCSX2');
    paths.push('D:\\Emulators\\PCSX2');

    return paths;
  }

  public buildArgs(options: AdapterBuildArgsOptions): string[] {
    const args: string[] = [];

    // Fullscreen flag
    const isFullscreen = options.profile?.fullscreen !== false;
    if (isFullscreen) {
      if (options.emulator.fullscreenArgs) {
        args.push(...options.emulator.fullscreenArgs.trim().split(/\s+/).filter(Boolean));
      } else {
        args.push('-fullscreen');
      }
    }

    // Batch flag (auto exit on game stop)
    args.push('-batch');

    // Custom arguments
    this.appendCustomArgs(args, options);

    // End of options indicator and ROM path
    args.push('--', options.romPath);

    return args;
  }
}
