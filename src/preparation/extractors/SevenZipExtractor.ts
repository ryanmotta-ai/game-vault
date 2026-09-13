import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sevenBin from '7zip-bin';
import {
  IArchiveExtractor,
  ArchiveMetadata,
  ExtractedFileInfo,
  ExtractionOptions,
  validateEntryPath
} from './ArchiveExtractor';
import {
  ArchiveCorruptedError,
  ExtractionCancelledError,
  PreparationError
} from '../../core/errors/AppError';

export class SevenZipExtractor implements IArchiveExtractor {
  private binaryPath: string;

  constructor(customBinaryPath?: string) {
    this.binaryPath = customBinaryPath || sevenBin.path7za;
  }

  public canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.7z';
  }

  public async inspect(archivePath: string): Promise<ArchiveMetadata> {
    if (!fs.existsSync(archivePath)) {
      throw new ArchiveCorruptedError(`Archive file not found at: ${archivePath}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, ['l', '-slt', archivePath]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        reject(new ArchiveCorruptedError(`Failed to execute 7za: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new ArchiveCorruptedError(`7za inspect returned error code ${code}: ${stderr || stdout}`));
          return;
        }

        try {
          // Parse -slt output blocks
          const blocks = stdout.split(/\r?\n\r?\n/);
          let uncompressedSizeBytes = 0;
          let fileCount = 0;
          const entryNames: string[] = [];

          for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            let entryPath: string | null = null;
            let size = 0;
            let isFolder = false;

            for (const line of lines) {
              if (line.startsWith('Path = ')) {
                entryPath = line.substring(7).trim();
              } else if (line.startsWith('Size = ')) {
                size = parseInt(line.substring(7).trim(), 10) || 0;
              } else if (line.startsWith('Folder = ') && line.includes('+')) {
                isFolder = true;
              } else if (line.startsWith('Attributes = ') && line.includes('D')) {
                isFolder = true;
              }
            }

            // Exclude header block which has Path = archivePath
            if (entryPath && !isFolder && entryPath !== archivePath) {
              fileCount++;
              uncompressedSizeBytes += size;
              entryNames.push(entryPath);
            }
          }

          resolve({
            format: '7z',
            uncompressedSizeBytes,
            fileCount,
            entryNames
          });
        } catch (parseErr) {
          reject(new ArchiveCorruptedError(`Failed to parse 7za output: ${String(parseErr)}`));
        }
      });
    });
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

    // 1. Pre-flight security check on entry names
    const metadata = await this.inspect(archivePath);
    for (const name of metadata.entryNames) {
      validateEntryPath(name, targetDir);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 2. Spawn 7za extraction
    return new Promise((resolve, reject) => {
      // 7za x -y -bsp1 -o<targetDir> <archivePath>
      const args = ['x', '-y', '-bsp1', `-o${targetDir}`, archivePath];
      const child = spawn(this.binaryPath, args);

      let isCancelled = false;
      const abortHandler = () => {
        isCancelled = true;
        child.kill('SIGTERM');
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;

        // Parse percentage progress from 7z output: e.g. " 34% 12"
        const match = text.match(/([0-9]{1,3})%/);
        if (match && options?.onProgress) {
          const percentage = Math.min(100, parseInt(match[1], 10));
          const processedBytes = Math.round((percentage / 100) * metadata.uncompressedSizeBytes);
          options.onProgress({
            percentage,
            processedBytes,
            totalBytes: metadata.uncompressedSizeBytes
          });
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (options?.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }
        reject(new PreparationError(`Failed to run 7za: ${err.message}`));
      });

      child.on('close', (code) => {
        if (options?.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }

        if (isCancelled || options?.signal?.aborted) {
          reject(new ExtractionCancelledError());
          return;
        }

        if (code !== 0) {
          reject(new ArchiveCorruptedError(`7za extraction failed with code ${code}: ${stderr || stdout}`));
          return;
        }

        // 3. Post-extraction inventory & security boundary confirmation
        try {
          const extractedFiles: ExtractedFileInfo[] = [];
          const collectFiles = (dir: string) => {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
              const fullPath = path.join(dir, item.name);
              // Boundary check
              validateEntryPath(path.relative(targetDir, fullPath), targetDir);

              if (item.isDirectory()) {
                collectFiles(fullPath);
              } else if (item.isFile()) {
                const stat = fs.statSync(fullPath);
                extractedFiles.push({
                  path: fullPath,
                  relativePath: path.relative(targetDir, fullPath).replace(/\\/g, '/'),
                  sizeBytes: stat.size
                });
              }
            }
          };

          collectFiles(targetDir);

          if (options?.onProgress) {
            options.onProgress({
              percentage: 100,
              processedBytes: metadata.uncompressedSizeBytes,
              totalBytes: metadata.uncompressedSizeBytes
            });
          }

          resolve(extractedFiles);
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}
