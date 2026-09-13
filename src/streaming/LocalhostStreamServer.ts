import http from 'node:http';
import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import { BlockCache } from './BlockCache';
import { logger } from '../core/logger';

export interface StreamServerOptions {
  blockCache: BlockCache;
  totalSizeBytes: number;
  filename: string;
}

export class LocalhostStreamServer {
  private log = logger.child('LocalhostStreamServer');
  private server?: http.Server;
  private token: string;
  private port = 0;
  private blockCache: BlockCache;
  private totalSizeBytes: number;
  private filename: string;

  constructor(
    blockCacheOrOptions: BlockCache | StreamServerOptions,
    totalSizeBytes?: number,
    filename?: string
  ) {
    if (blockCacheOrOptions instanceof BlockCache) {
      this.blockCache = blockCacheOrOptions;
      this.totalSizeBytes = totalSizeBytes ?? 0;
      this.filename = filename ?? 'game.rom';
    } else {
      this.blockCache = blockCacheOrOptions.blockCache;
      this.totalSizeBytes = blockCacheOrOptions.totalSizeBytes;
      this.filename = blockCacheOrOptions.filename;
    }
    this.token = crypto.randomBytes(16).toString('hex');
  }

  public getToken(): string {
    return this.token;
  }

  public getPort(): number {
    return this.port;
  }

  public getStreamUrl(): string {
    return `http://127.0.0.1:${this.port}/session/${this.token}/${encodeURIComponent(this.filename)}`;
  }

  public async start(): Promise<string> {
    if (this.server) {
      return this.getStreamUrl();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enforce loopback connection security
        const remoteAddr = req.socket.remoteAddress;
        if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: localhost loopback access only.');
          return;
        }

        const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
        const pathParts = url.pathname.split('/').filter(Boolean);

        // Expected format: /session/:token/:filename
        if (pathParts.length < 3 || pathParts[0] !== 'session' || pathParts[1] !== this.token) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: invalid or expired session capability token.');
          return;
        }

        const method = req.method?.toUpperCase();

        if (method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': this.totalSizeBytes.toString(),
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'bytes'
          });
          res.end();
          return;
        }

        if (method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
          return;
        }

        const rangeHeader = req.headers['range'];

        if (!rangeHeader) {
          // Serve full file or initial range
          res.writeHead(200, {
            'Content-Length': this.totalSizeBytes.toString(),
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'bytes'
          });

          try {
            const data = await this.blockCache.readRange(0, Math.min(this.totalSizeBytes - 1, 4 * 1024 * 1024));
            res.end(data);
          } catch (err: any) {
            this.log.error('Stream read error:', err.message);
            res.end();
          }
          return;
        }

        // Parse Range: bytes=start-end
        const match = rangeHeader.match(/^bytes=(\d+)-(\d+)?$/i);
        if (!match) {
          res.writeHead(416, {
            'Content-Range': `bytes */${this.totalSizeBytes}`
          });
          res.end();
          return;
        }

        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : this.totalSizeBytes - 1;

        if (start < 0 || start >= this.totalSizeBytes || end < start) {
          res.writeHead(416, {
            'Content-Range': `bytes */${this.totalSizeBytes}`
          });
          res.end();
          return;
        }

        const clampedEnd = Math.min(end, this.totalSizeBytes - 1);
        const chunkLength = clampedEnd - start + 1;

        try {
          const chunkData = await this.blockCache.readRange(start, clampedEnd);

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${clampedEnd}/${this.totalSizeBytes}`,
            'Content-Length': chunkLength.toString(),
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'bytes'
          });

          res.end(chunkData);
        } catch (err: any) {
          this.log.error(`Failed to serve range [${start}-${clampedEnd}]:`, err.message);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Streaming Error');
        }
      });

      // Bind exclusively to 127.0.0.1 on OS-assigned ephemeral port (0)
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        this.log.info(`LocalhostStreamServer listening at ${this.getStreamUrl()}`);
        resolve(this.getStreamUrl());
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = undefined;
        resolve();
      });
    });
  }
}
