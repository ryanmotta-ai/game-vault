import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

/**
 * Calculates MD5 hex checksum of a local file using streaming I/O.
 * Memory consumption is O(1) buffer size regardless of whether the file is 10 MB or 150 GB.
 */
export async function calculateFileMd5(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('md5');
  const readStream = fs.createReadStream(filePath, { signal });

  await pipeline(readStream, hash);
  return hash.digest('hex');
}
