import fs from 'node:fs';
import path from 'node:path';
import { createExtractorFromFile } from 'node-unrar-js';
import {
  IArchiveExtractor,
  ArchiveMetadata,
  ExtractedFileInfo,
  ExtractionOptions,
  validateEntryPath
} from './ArchiveExtractor';
import {
  ArchiveCorruptedError,
  ExtractionCancelledError
} from '../../core/errors/AppError';
import { logger } from '../../core/logger';

export class RarExtractor implements IArchiveExtractor {
  private log = logger.child('RarExtractor');

  public canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.rar';
  }

  public async inspect(archivePath: string): Promise<ArchiveMetadata> {
    if (!fs.existsSync(archivePath)) {
      throw new ArchiveCorruptedError(`Archive file not found at: ${archivePath}`);
    }

    try {
      const extractor = await createExtractorFromFile({ filepath: archivePath });
      const list = extractor.getFileList();
      const files = [...list.fileHeaders];

      let uncompressedSizeBytes = 0;
      let fileCount = 0;
      const entryNames: string[] = [];

      for (const file of files) {
        if (!file.flags.directory) {
          uncompressedSizeBytes += file.unpSize;
          fileCount++;
          entryNames.push(file.name);
        }
      }

      return {
        format: 'rar',
        uncompressedSizeBytes,
        fileCount,
        entryNames
      };
    } catch (err: unknown) {
      this.log.error(`Failed to inspect RAR archive ${archivePath}:`, err);
      throw new ArchiveCorruptedError(
        `Failed to read RAR archive: ${err instanceof Error ? err.message : String(err)}`
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

    let extractor: Awaited<ReturnType<typeof createExtractorFromFile>>;
    try {
      extractor = await createExtractorFromFile({ filepath: archivePath });
    } catch (err) {
      throw new ArchiveCorruptedError(`Corrupted RAR archive: ${err instanceof Error ? err.message : String(err)}`);
    }

    const fileList = extractor.getFileList();
    const headers = [...fileList.fileHeaders];

    // 1. Critical Pre-Flight Security Check: Validate ALL entry paths before writing anything
    for (const h of headers) {
      validateEntryPath(h.name, targetDir);
    }

    // 2. Compute total uncompressed bytes
    let totalBytes = 0;
    for (const h of headers) {
      if (!h.flags.directory) {
        totalBytes += h.unpSize;
      }
    }
    if (totalBytes === 0) totalBytes = 1;

    let processedBytes = 0;
    const extractedFiles: ExtractedFileInfo[] = [];

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 3. Extract all entries
    const extracted = extractor.extract();
    const files = [...extracted.files];

    for (const file of files) {
      if (options?.signal?.aborted) {
        throw new ExtractionCancelledError();
      }

      const destPath = validateEntryPath(file.fileHeader.name, targetDir);

      if (file.fileHeader.flags.directory) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        continue;
      }

      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (file.extraction) {
        fs.writeFileSync(destPath, Buffer.from(file.extraction));
      } else {
        fs.writeFileSync(destPath, Buffer.alloc(0));
      }

      processedBytes += file.fileHeader.unpSize;
      const percentage = Math.min(100, Math.round((processedBytes / totalBytes) * 100));

      const relPath = path.relative(targetDir, destPath).replace(/\\/g, '/');
      extractedFiles.push({
        path: destPath,
        relativePath: relPath,
        sizeBytes: file.fileHeader.unpSize
      });

      if (options?.onProgress) {
        options.onProgress({
          processedBytes,
          totalBytes,
          percentage,
          currentFile: file.fileHeader.name
        });
      }
    }

    return extractedFiles;
  }
}
