import fs from 'node:fs';
import path from 'node:path';
import { GameManifest } from '../core/types';
import { GameManifestsRepository } from '../database/repositories/gameManifestsRepository';
import { calculateFileMd5 } from '../core/utils/checksum';
import { logger } from '../core/logger';

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  verifiedFiles: number;
}

export class LocalManifestService {
  private log = logger.child('LocalManifestService');

  constructor(private manifestsRepo?: GameManifestsRepository) {}

  public setRepository(repo: GameManifestsRepository): void {
    this.manifestsRepo = repo;
  }

  /**
   * Saves game manifest to disk (manifest.json) and persists in database.
   */
  public async saveManifest(manifest: GameManifest, gameDir: string): Promise<void> {
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }

    const manifestFilePath = path.join(gameDir, 'manifest.json');
    const jsonContent = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestFilePath, jsonContent, 'utf-8');

    if (this.manifestsRepo) {
      this.manifestsRepo.upsert(manifest);
    }

    this.log.info(`Saved local manifest for game ${manifest.gameId} (${manifest.title}) at ${manifestFilePath}`);
  }

  /**
   * Loads manifest from disk or database fallback.
   */
  public getManifest(gameId: string, gameDir?: string): GameManifest | null {
    if (gameDir) {
      const diskPath = path.join(gameDir, 'manifest.json');
      if (fs.existsSync(diskPath)) {
        try {
          const content = fs.readFileSync(diskPath, 'utf-8');
          return JSON.parse(content) as GameManifest;
        } catch (err) {
          this.log.warn(`Failed to read manifest.json at ${diskPath}:`, err);
        }
      }
    }

    if (this.manifestsRepo) {
      return this.manifestsRepo.getByGameId(gameId);
    }

    return null;
  }

  /**
   * Verifies local game files against manifest.
   * Cheap verify: verifies file existence and exact size.
   * Deep verify: computes MD5 checksums for files that have expected hashes.
   */
  public async verifyLocalGame(
    gameId: string,
    gameDir: string,
    deepVerify = false
  ): Promise<VerificationResult> {
    const manifest = this.getManifest(gameId, gameDir);
    const errors: string[] = [];
    let verifiedCount = 0;

    if (!manifest) {
      return {
        valid: false,
        errors: [`No manifest found for game ${gameId} in ${gameDir} or database.`],
        verifiedFiles: 0
      };
    }

    // Verify primary executable or rom
    const primaryPath = path.isAbsolute(manifest.primaryExecutableOrRom)
      ? manifest.primaryExecutableOrRom
      : path.join(gameDir, manifest.primaryExecutableOrRom);

    if (!fs.existsSync(primaryPath)) {
      errors.push(`Primary playable file is missing: ${primaryPath}`);
    }

    // Verify all manifest files
    for (const file of manifest.files) {
      const filePath =
        file.path && path.isAbsolute(file.path) ? file.path : path.join(gameDir, file.relativePath);

      if (!fs.existsSync(filePath)) {
        errors.push(`File missing: ${file.relativePath}`);
        continue;
      }

      const stat = fs.statSync(filePath);
      if (stat.size !== file.sizeBytes) {
        errors.push(
          `File size mismatch for ${file.relativePath}: expected ${file.sizeBytes} bytes, found ${stat.size} bytes`
        );
        continue;
      }

      if (deepVerify && file.md5Checksum) {
        try {
          const actualMd5 = await calculateFileMd5(filePath);
          if (actualMd5.toLowerCase() !== file.md5Checksum.toLowerCase()) {
            errors.push(
              `MD5 checksum mismatch for ${file.relativePath}: expected ${file.md5Checksum}, calculated ${actualMd5}`
            );
            continue;
          }
        } catch (err) {
          errors.push(`Failed to calculate checksum for ${file.relativePath}: ${String(err)}`);
          continue;
        }
      }

      verifiedCount++;
    }

    return {
      valid: errors.length === 0,
      errors,
      verifiedFiles: verifiedCount
    };
  }
}
