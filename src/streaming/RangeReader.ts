import { StorageProvider } from '../providers/StorageProvider';
import { RangeReadResult } from '../core/types';
import {
  RangeOutOfBoundsError,
  InvalidRangeResponseError,
  DownloadCancelledError,
  RemoteNotFoundError
} from '../core/errors/AppError';
import { logger } from '../core/logger';

export interface RangeReaderOptions {
  provider: StorageProvider;
  fileId: string;
  expectedFileSize?: number;
  maxRetries?: number;
}

export interface RangeReadMetricsSnapshot {
  averageLatencyMs: number;
  lastThroughputBps: number;
  totalBytesRead: number;
  totalRequests: number;
  failedRequests: number;
}

export class RangeReader {
  private log = logger.child('RangeReader');
  private provider: StorageProvider;
  private fileId: string;
  private expectedFileSize?: number;
  private maxRetries: number;

  private totalBytesRead = 0;
  private totalRequests = 0;
  private failedRequests = 0;
  private totalLatencyMs = 0;
  private lastThroughputBps = 0;

  constructor(options: RangeReaderOptions) {
    this.provider = options.provider;
    this.fileId = options.fileId;
    this.expectedFileSize = options.expectedFileSize;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public getMetrics(): RangeReadMetricsSnapshot {
    return {
      averageLatencyMs: this.totalRequests > 0 ? Math.round(this.totalLatencyMs / this.totalRequests) : 0,
      lastThroughputBps: this.lastThroughputBps,
      totalBytesRead: this.totalBytesRead,
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests
    };
  }

  public async readRange(
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<RangeReadResult> {
    // 1. Validate inputs & bounds
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start > Number.MAX_SAFE_INTEGER ||
      end > Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeOutOfBoundsError(start, end, this.expectedFileSize);
    }

    if (
      this.expectedFileSize !== undefined &&
      this.expectedFileSize > 0 &&
      (start >= this.expectedFileSize || end >= this.expectedFileSize)
    ) {
      throw new RangeOutOfBoundsError(start, end, this.expectedFileSize);
    }

    const actualEnd = end;

    if (!this.provider.readRange) {
      throw new InvalidRangeResponseError(
        `Storage provider "${this.provider.name}" does not support range reads.`
      );
    }

    let attempt = 0;
    let delayMs = 500;

    while (attempt <= this.maxRetries) {
      if (signal?.aborted) {
        throw new DownloadCancelledError(`Range read cancelled for file ${this.fileId}`);
      }

      const startTime = Date.now();
      try {
        this.totalRequests++;
        const result = await this.provider.readRange(this.fileId, start, actualEnd, signal);
        const elapsed = Math.max(1, Date.now() - startTime);

        this.totalLatencyMs += elapsed;
        this.totalBytesRead += result.data.length;
        this.lastThroughputBps = Math.round((result.data.length / elapsed) * 1000);

        return result;
      } catch (err: any) {
        this.failedRequests++;

        if (signal?.aborted || err instanceof DownloadCancelledError) {
          throw new DownloadCancelledError(`Range read cancelled for file ${this.fileId}`);
        }

        if (err instanceof RemoteNotFoundError || err?.statusCode === 404) {
          throw err;
        }

        // 416 Range Not Satisfiable: do not retry
        if (err?.statusCode === 416 || err instanceof RangeOutOfBoundsError) {
          throw err;
        }

        attempt++;
        if (attempt > this.maxRetries) {
          this.log.error(
            `Exhausted range read retries (${this.maxRetries}) for file ${this.fileId} [${start}-${actualEnd}]:`,
            err.message
          );
          throw err;
        }

        this.log.warn(
          `Range read error for file ${this.fileId} (attempt ${attempt}/${this.maxRetries}): ${err.message}. Retrying in ${delayMs}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 4000) + Math.round(Math.random() * 200);
      }
    }

    throw new InvalidRangeResponseError(`Failed to read range [${start}-${actualEnd}] for file ${this.fileId}`);
  }
}
