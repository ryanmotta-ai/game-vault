import path from 'node:path';
import { ZipSlipSecurityError } from '../../core/errors/AppError';

export type ArchiveFormat = 'zip' | '7z' | 'rar';

export interface ArchiveMetadata {
  format: ArchiveFormat;
  uncompressedSizeBytes: number;
  fileCount: number;
  entryNames: string[];
}

export interface ExtractedFileInfo {
  path: string;
  relativePath: string;
  sizeBytes: number;
}

export interface ExtractionProgress {
  processedBytes: number;
  totalBytes: number;
  percentage: number;
  currentFile?: string;
}

export interface ExtractionOptions {
  onProgress?: (progress: ExtractionProgress) => void;
  signal?: AbortSignal;
}

export interface IArchiveExtractor {
  canHandle(filePath: string): boolean;
  inspect(archivePath: string): Promise<ArchiveMetadata>;
  extract(archivePath: string, targetDir: string, options?: ExtractionOptions): Promise<ExtractedFileInfo[]>;
}

/**
 * Validates that an archive entry relative path does not escape the destination target directory.
 * Throws ZipSlipSecurityError if path traversal, absolute path, UNC, or drive letter is detected.
 */
export function validateEntryPath(rawEntryName: string, targetDir: string): string {
  if (!rawEntryName || typeof rawEntryName !== 'string') {
    throw new ZipSlipSecurityError('Empty or invalid entry name', targetDir);
  }

  // Normalize slashes for analysis
  const normalized = rawEntryName.replace(/\\/g, '/');

  // Check for path traversal sequences
  if (normalized.includes('../') || normalized === '..' || normalized.endsWith('/..')) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  // Check for absolute Unix path
  if (normalized.startsWith('/')) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  // Check for Windows drive letter (e.g. C:, D:)
  if (/^[a-zA-Z]:/i.test(rawEntryName)) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  // Check for UNC network path (e.g. \\server\share)
  if (rawEntryName.startsWith('\\\\') || rawEntryName.startsWith('//')) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  // Check for null bytes
  if (rawEntryName.includes('\0')) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  // Resolve absolute path and verify boundary containment
  const resolvedTarget = path.resolve(targetDir, rawEntryName);
  const normalizedTargetDir = path.resolve(targetDir);

  const relative = path.relative(normalizedTargetDir, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ZipSlipSecurityError(rawEntryName, targetDir);
  }

  return resolvedTarget;
}
