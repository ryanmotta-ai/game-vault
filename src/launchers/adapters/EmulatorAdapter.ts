import fs from 'node:fs';
import path from 'node:path';
import { EmulatorAdapter, AdapterBuildArgsOptions } from '../types';
import { EmulatorAdapterType, GamePlatform } from '../../core/types';

export abstract class BaseEmulatorAdapter implements EmulatorAdapter {
  abstract id: EmulatorAdapterType;
  abstract name: string;
  abstract supportedPlatforms: GamePlatform[];

  abstract buildArgs(options: AdapterBuildArgsOptions): string[];
  abstract getDefaultExecutableNames(): string[];
  abstract getStandardSearchPaths(): string[];

  public async validateExecutable(
    executablePath: string
  ): Promise<{ valid: boolean; version?: string; error?: string }> {
    if (!executablePath || typeof executablePath !== 'string') {
      return { valid: false, error: 'Executable path cannot be empty.' };
    }

    try {
      if (!fs.existsSync(executablePath)) {
        return { valid: false, error: `File does not exist: ${executablePath}` };
      }

      const stat = fs.statSync(executablePath);
      if (!stat.isFile()) {
        return { valid: false, error: `Path is not a regular file: ${executablePath}` };
      }

      const ext = path.extname(executablePath).toLowerCase();
      if (process.platform === 'win32' && ext !== '.exe' && ext !== '.bat' && ext !== '.cmd') {
        return {
          valid: false,
          error: `Executable must have an executable extension (.exe, .bat, .cmd), found '${ext}'`
        };
      }

      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Failed to inspect executable file.' };
    }
  }

  protected appendCustomArgs(args: string[], options: AdapterBuildArgsOptions): void {
    if (options.profile?.argumentsTemplate) {
      const custom = options.profile.argumentsTemplate.trim().split(/\s+/).filter(Boolean);
      args.push(...custom);
    } else if (options.emulator?.defaultArgs) {
      const custom = options.emulator.defaultArgs.trim().split(/\s+/).filter(Boolean);
      args.push(...custom);
    }
  }
}
