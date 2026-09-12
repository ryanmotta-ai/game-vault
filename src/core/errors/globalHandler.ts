import { logger } from '../logger';
import { AppError } from './AppError';

export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('CRITICAL: Uncaught Exception in Node process', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (reason instanceof AppError) {
      logger.error(`Unhandled Promise Rejection [${reason.code}]: ${reason.message}`, {
        details: reason.details,
        stack: reason.stack
      });
    } else if (reason instanceof Error) {
      logger.error(`Unhandled Promise Rejection: ${reason.message}`, {
        name: reason.name,
        stack: reason.stack
      });
    } else {
      logger.error('Unhandled Promise Rejection with unknown reason', { reason });
    }
  });
}
