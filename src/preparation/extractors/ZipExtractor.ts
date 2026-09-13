import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import {
  IArchiveExtractor,
  ArchiveMetadata,
  ExtractedFileInfo,
  ExtractionOptions,
  validateEntryPath
} from './ArchiveExtractor';
import { ArchiveCorruptedError, ExtractionCancelledError } from '../../core/errors/AppError';
import { logger } from '../../core/logger';

export class ZipExtractor implements IArchiveExtractor {
  private log = logger.child('ZipExtractor');

  public canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.zip';
  }

  public async inspect(archivePath: string): Promise<ArchiveMetadata> {
    if (!fs.existsSync(archivePath)) {
      throw new ArchiveCorruptedError(`Archive file not found at: ${archivePath}`);
    }

    try {
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      let uncompressedSizeBytes = 0;
      let fileCount = 0;
      const entryNames: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory) {
          uncompressedSizeBytes += entry.header.size;
          fileCount++;
          entryNames.push(entry.entryName);
        }
      }

      return {
        format: 'zip',
        uncompressedSizeBytes,
        fileCount,
        entryNames
      };
    } catch (err: unknown) {
      this.log.error(`Failed to inspect ZIP archive ${archivePath}:`, err);
      throw new ArchiveCorruptedError(
        `Failed to read ZIP archive: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public async extract(
    archivePath: string,
    targetDir: string,
    options?: ExtractionOptions
  ): Promise<ExtractedFileInfo[]> {
    if (options?.signal?.aborted) {
      throw new ExtractionCancelledError();
    }

    if (!fs.existsSync(archivePath)) {
      throw new ArchiveCorruptedError(`Archive file not found at: ${archivePath}`);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(archivePath);
    } catch (err) {
      throw new ArchiveCorruptedError(`Corrupted ZIP archive: ${err instanceof Error ? err.message : String(err)}`);
    }

    const entries = zip.getEntries();

    // 1. Critical Pre-Flight Security Check: Validate ALL entry paths before writing anything
    for (const entry of entries) {
      validateEntryPath(entry.entryName, targetDir);
    }

    // 2. Compute total uncompressed bytes for progress tracking
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isDirectory) {
        totalBytes += entry.header.size;
      }
    }
    if (totalBytes === 0) totalBytes = 1;

    let processedBytes = 0;
    const extractedFiles: ExtractedFileInfo[] = [];

    // Ensure root target dir exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 3. Extract entry by entry with cancellation check and progress notification
    for (const entry of entries) {
      if (options?.signal?.aborted) {
        throw new ExtractionCancelledError();
      }

      const destPath = validateEntryPath(entry.entryName, targetDir);

      if (entry.isDirectory) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        continue;
      }

      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const data = entry.getData();
      fs.writeFileSync(destPath, data);

      processedBytes += entry.header.size;
      const percentage = Math.min(100, Math.round((processedBytes / totalBytes) * 100));

      const relPath = path.relative(targetDir, destPath).replace(/\\/g, '/');
      extractedFiles.push({
        path: destPath,
        relativePath: relPath,
        sizeBytes: data.length
      });

      if (options?.onProgress) {
        options.onProgress({
          processedBytes,
          totalBytes,
          percentage,
          currentFile: entry.entryName
        });
      }
    }

    return extractedFiles;
  }
}
