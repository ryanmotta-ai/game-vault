import { spawn, ChildProcess } from 'node:child_process';
import { Game, GameSession, LauncherType, LaunchCommand, GameRunningStateEvent } from '../core/types';
import { GameSessionsRepository } from '../database/repositories/gameSessionsRepository';
import { GamesRepository } from '../database/repositories/gamesRepository';
import { GameAlreadyRunningError, ProcessLaunchFailedError } from '../core/errors/AppError';
import { logger } from '../core/logger';
import { ActiveProcessSession } from './types';

export class ProcessMonitor {
  private log = logger.child('ProcessMonitor');
  private activeSessions = new Map<string, ActiveProcessSession>();
  private stateListeners = new Set<(event: GameRunningStateEvent) => void>();

  constructor(
    private gameSessionsRepo: GameSessionsRepository,
    private gamesRepo: GamesRepository
  ) {}

  public isGameRunning(gameId: string): boolean {
    return this.activeSessions.has(gameId);
  }

  public getRunningGames(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  public getActiveSession(gameId: string): ActiveProcessSession | undefined {
    return this.activeSessions.get(gameId);
  }

  public onRunningStateChange(listener: (event: GameRunningStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyStateChange(event: GameRunningStateEvent): void {
    for (const listener of this.stateListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('Error in running state listener:', err);
      }
    }
  }

  public async launchProcess(
    command: LaunchCommand,
    game: Game,
    launcherType: LauncherType,
    emulatorId?: string
  ): Promise<GameSession> {
    if (this.isGameRunning(game.id)) {
      throw new GameAlreadyRunningError(game.title);
    }

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const startedAt = new Date().toISOString();

    const session: GameSession = {
      id: sessionId,
      gameId: game.id,
      startedAt,
      durationSeconds: 0,
      launcherType,
      emulatorId,
      crashed: false,
      createdAt: startedAt
    };

    this.gameSessionsRepo.create(session);

    this.log.info(
      `Launching game "${game.title}" (${game.id}) with ${launcherType}: "${command.executable}" (Args: ${command.args.length}, Cwd: "${command.cwd}")`
    );

    let child: ChildProcess;
    try {
      // Zero shell usage: spawn directly with arguments array and shell: false
      child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...(command.env || {}) },
        shell: false,
        detached: false,
        stdio: 'ignore'
      });
    } catch (err: any) {
      const endedAt = new Date().toISOString();
      this.gameSessionsRepo.complete(sessionId, {
        endedAt,
        durationSeconds: 0,
        exitCode: -1,
        crashed: true
      });
      throw new ProcessLaunchFailedError(err.message || 'Failed to spawn process.');
    }

    if (!child.pid) {
      const endedAt = new Date().toISOString();
      this.gameSessionsRepo.complete(sessionId, {
        endedAt,
        durationSeconds: 0,
        exitCode: -1,
        crashed: true
      });
      throw new ProcessLaunchFailedError(`Process spawned without valid PID: ${command.executable}`);
    }

    const activeRecord: ActiveProcessSession = {
      sessionId,
      gameId: game.id,
      launcherType,
      emulatorId,
      startedAt,
      process: child
    };

    this.activeSessions.set(game.id, activeRecord);
    this.notifyStateChange({
      gameId: game.id,
      sessionId,
      isRunning: true,
      startedAt
    });

    child.on('error', (err) => {
      this.log.error(`Process error for game "${game.title}" (${game.id}):`, err);
      const endedAt = new Date().toISOString();
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      );

      this.gameSessionsRepo.complete(sessionId, {
        endedAt,
        durationSeconds,
        exitCode: -1,
        crashed: true
      });

      this.gamesRepo.recordSessionPlaytime(game.id, durationSeconds, endedAt);
      this.activeSessions.delete(game.id);
      this.notifyStateChange({
        gameId: game.id,
        sessionId,
        isRunning: false
      });
    });

    child.on('exit', (code, signal) => {
      const endedAt = new Date().toISOString();
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      );

      const crashed = (code !== null && code !== 0) || signal !== null;

      this.log.info(
        `Process finished for "${game.title}". Exit Code: ${code}, Signal: ${signal}, Duration: ${durationSeconds}s, Crashed: ${crashed}`
      );

      this.gameSessionsRepo.complete(sessionId, {
        endedAt,
        durationSeconds,
        exitCode: code ?? undefined,
        crashed
      });

      this.gamesRepo.recordSessionPlaytime(game.id, durationSeconds, endedAt);
      this.activeSessions.delete(game.id);
      this.notifyStateChange({
        gameId: game.id,
        sessionId,
        isRunning: false
      });
    });

    return session;
  }

  public async stopProcess(gameId: string): Promise<boolean> {
    const active = this.activeSessions.get(gameId);
    if (!active) return false;

    try {
      this.log.info(`Stopping active process for game ID: ${gameId}`);
      active.process.kill();
      return true;
    } catch (err) {
      this.log.error(`Failed to kill process for game ID ${gameId}:`, err);
      return false;
    }
  }

  public shutdown(): void {
    this.log.info(`Shutting down ProcessMonitor with ${this.activeSessions.size} active session(s)...`);
    const now = new Date().toISOString();

    for (const [gameId, active] of this.activeSessions.entries()) {
      try {
        const durationSeconds = Math.max(
          0,
          Math.round((new Date(now).getTime() - new Date(active.startedAt).getTime()) / 1000)
        );

        // Record session duration up to shutdown time
        this.gameSessionsRepo.complete(active.sessionId, {
          endedAt: now,
          durationSeconds,
          exitCode: 0,
          crashed: false
        });
        this.gamesRepo.recordSessionPlaytime(gameId, durationSeconds, now);

        // Unref child process so it can live independently if user continues playing
        if (typeof active.process.unref === 'function') {
          active.process.unref();
        }
      } catch (err) {
        this.log.error(`Error finalizing session during shutdown for game ${gameId}:`, err);
      }
    }

    this.activeSessions.clear();
  }
}
