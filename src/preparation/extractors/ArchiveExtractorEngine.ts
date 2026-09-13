import fs from 'node:fs';
import path from 'node:path';
import {
  IArchiveExtractor,
  ArchiveMetadata,
  ExtractedFileInfo,
  ExtractionOptions
} from './ArchiveExtractor';
import { ZipExtractor } from './ZipExtractor';
import { SevenZipExtractor } from './SevenZipExtractor';
import { RarExtractor } from './RarExtractor';
import { UnsupportedArchiveFormatError } from '../../core/errors/AppError';
import { logger } from '../../core/logger';

export class ArchiveExtractorEngine {
  private log = logger.child('ArchiveExtractorEngine');
  private extractors: IArchiveExtractor[];

  constructor(customExtractors?: IArchiveExtractor[]) {
    this.extractors = customExtractors || [
      new ZipExtractor(),
      new SevenZipExtractor(),
      new RarExtractor()
    ];
  }

  public isSupportedArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.zip', '.7z', '.rar'].includes(ext);
  }

  public getExtractor(filePath: string): IArchiveExtractor {
    const extractor = this.extractors.find((e) => e.canHandle(filePath));
    if (!extractor) {
      throw new UnsupportedArchiveFormatError(path.extname(filePath));
    }
    return extractor;
  }

  public async inspect(archivePath: string): Promise<ArchiveMetadata> {
    const extractor = this.getExtractor(archivePath);
    return await extractor.inspect(archivePath);
  }

  /**
   * Estimates the uncompressed size of an archive or file.
   * If archive metadata can be read, returns exact uncompressed sum.
   * If reading metadata fails or is unavailable, uses a conservative 2.5x estimate.
   */
  public async estimateExtractionSize(filePath: string): Promise<number> {
    if (!fs.existsSync(filePath)) return 0;
    const stat = fs.statSync(filePath);

    if (!this.isSupportedArchive(filePath)) {
      // Raw file: 1.0x size
      return stat.size;
    }

    try {
      const metadata = await this.inspect(filePath);
      if (metadata.uncompressedSizeBytes > 0) {
        return metadata.uncompressedSizeBytes;
      }
    } catch (err) {
      this.log.warn(`Could not inspect archive header for ${filePath}, using conservative fallback:`, err);
    }

    // Conservative 2.5x compression ratio estimate
    return Math.round(stat.size * 2.5);
  }

  public async extract(
    archivePath: string,
    targetDir: string,
    options?: ExtractionOptions
  ): Promise<ExtractedFileInfo[]> {
    const extractor = this.getExtractor(archivePath);
    return await extractor.extract(archivePath, targetDir, options);
  }
}

export const defaultArchiveExtractorEngine = new ArchiveExtractorEngine();
