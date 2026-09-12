import { LaunchGameOptions, LaunchResult } from './types';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { logger } from '../core/logger';
import { NotImplementedError } from '../core/errors/AppError';

export class LauncherService {
  private log = logger.child('LauncherService');

  constructor(private gamesRepo: GamesRepository) {}

  public async launchGame(options: LaunchGameOptions): Promise<LaunchResult> {
    this.log.info(`Requesting game launch for ${options.gameId} via executable ${options.executablePath}`);
    const game = this.gamesRepo.getById(options.gameId);
    if (!game) {
      return { success: false, error: 'Game not found in database.' };
    }

    if (game.state !== 'READY') {
      return {
        success: false,
        error: `Cannot launch game in state '${game.state}'. Game must be READY.`
      };
    }

    // In Phase 4: safe child_process.spawn with process tracking and playtime calculation
    throw new NotImplementedError('LauncherService.launchGame (Phase 4)');
  }
}
