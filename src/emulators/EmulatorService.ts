import { Emulator, GamePlatform } from '../core/types';
import { LaunchEmulatorOptions } from './types';
import { EmulatorsRepository } from '../database/repositories/emulatorsRepository';
import { logger } from '../core/logger';
import { NotImplementedError } from '../core/errors/AppError';

export class EmulatorService {
  private log = logger.child('EmulatorService');

  constructor(private emulatorsRepo: EmulatorsRepository) {}

  public getEmulatorsForPlatform(platform: GamePlatform): Emulator[] {
    return this.emulatorsRepo.getByPlatform(platform);
  }

  public getAllEmulators(): Emulator[] {
    return this.emulatorsRepo.getAll();
  }

  public async launchWithEmulator(options: LaunchEmulatorOptions): Promise<{ success: boolean; error?: string }> {
    this.log.info(`Launching emulator ${options.emulatorId} with ROM: ${options.romPath}`);
    // In Phase 4: safe process spawn with emulator argument mapping
    throw new NotImplementedError('EmulatorService.launchWithEmulator (Phase 4)');
  }
}
