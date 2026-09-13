import { NetworkQuality } from '../core/types';

export interface NetworkSample {
  throughputBps: number;
  latencyMs: number;
  success: boolean;
  timestamp: number;
}

export class NetworkCapabilityEstimator {
  private samples: NetworkSample[] = [];
  private maxSamples = 20;

  constructor(initialQuality: NetworkQuality = 'GOOD') {
    // Seed with initial expectation
    const initialThroughput =
      initialQuality === 'EXCELLENT'
        ? 6 * 1024 * 1024
        : initialQuality === 'GOOD'
        ? 2.5 * 1024 * 1024
        : initialQuality === 'FAIR'
        ? 800 * 1024
        : 200 * 1024;
    const initialLatency = initialQuality === 'EXCELLENT' ? 50 : initialQuality === 'GOOD' ? 120 : 300;

    this.recordSample(initialThroughput, 1000, initialLatency, true);
  }

  public recordSample(
    bytesTransferred: number,
    durationMs: number,
    latencyMs = 100,
    success = true
  ): void {
    const elapsed = Math.max(1, durationMs);
    const throughputBps = Math.round((bytesTransferred / elapsed) * 1000);

    this.samples.push({
      throughputBps,
      latencyMs,
      success,
      timestamp: Date.now()
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  public estimateQuality(): NetworkQuality {
    if (this.samples.length === 0) {
      return 'GOOD';
    }

    const recent = this.samples.slice(-10);
    const successCount = recent.filter((s) => s.success).length;
    const failureRate = 1 - successCount / recent.length;

    if (failureRate >= 0.5) {
      return 'POOR';
    }

    const avgThroughput = recent.reduce((sum, s) => sum + s.throughputBps, 0) / recent.length;
    const avgLatency = recent.reduce((sum, s) => sum + s.latencyMs, 0) / recent.length;

    if (avgThroughput >= 5 * 1024 * 1024 && avgLatency <= 100) {
      return 'EXCELLENT';
    }
    if (avgThroughput >= 1.5 * 1024 * 1024 && avgLatency <= 250) {
      return 'GOOD';
    }
    if (avgThroughput >= 400 * 1024 && avgLatency <= 600) {
      return 'FAIR';
    }

    return 'POOR';
  }

  public getAverageThroughputBps(): number {
    if (this.samples.length === 0) return 0;
    return Math.round(
      this.samples.reduce((sum, s) => sum + s.throughputBps, 0) / this.samples.length
    );
  }

  public getQuality(): NetworkQuality {
    return this.estimateQuality();
  }

  public getMetrics(): { throughputBps: number; averageLatencyMs: number } {
    const avgLatency =
      this.samples.length > 0
        ? Math.round(this.samples.reduce((sum, s) => sum + s.latencyMs, 0) / this.samples.length)
        : 0;
    return {
      throughputBps: this.getAverageThroughputBps(),
      averageLatencyMs: avgLatency
    };
  }

  public reset(): void {
    this.samples = [];
  }
}
