import { CloudFile, CloudFileClassification, CandidateConfidence, GamePlatform } from '../core/types';
import { PlatformRegistry } from './PlatformRegistry';
import { ExtensionRegistry } from './ExtensionRegistry';

export interface ClassificationResult {
  classification: CloudFileClassification;
  detectedPlatform?: GamePlatform;
  confidenceScore: number;
  confidence: CandidateConfidence;
}

export class FileClassifier {
  /**
   * Evaluates a cloud file based on folder hierarchy and extension signals.
   */
  public static classify(file: Pick<CloudFile, 'name' | 'extension' | 'remotePath' | 'isFolder' | 'sizeBytes'>): ClassificationResult {
    if (file.isFolder) {
      return {
        classification: 'UNKNOWN',
        confidenceScore: 0,
        confidence: 'LOW'
      };
    }

    const ext = file.extension ? file.extension.toLowerCase() : ExtensionRegistry.normalizeExtension(file.name);
    const filename = file.name.toLowerCase();

    // 1. Ignored files (documents, images, music, subtitles, metadata)
    if (ExtensionRegistry.isIgnored(file.name, ext)) {
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.flac', '.wav', '.mp4', '.mkv', '.avi'].includes(ext)) {
        return { classification: 'MEDIA', confidenceScore: 0, confidence: 'LOW' };
      }
      return { classification: 'DOCUMENT', confidenceScore: 0, confidence: 'LOW' };
    }

    const pathPlatform = PlatformRegistry.detectPlatformFromPath(file.remotePath);
    const extPlatforms = PlatformRegistry.getPlatformsByExtension(ext);

    // 2. Exclusive ROM formats
    if (ExtensionRegistry.isExclusiveRom(ext)) {
      if (pathPlatform && extPlatforms.includes(pathPlatform)) {
        return {
          classification: 'GAME',
          detectedPlatform: pathPlatform,
          confidenceScore: 0.95,
          confidence: 'HIGH'
        };
      }

      if (extPlatforms.length === 1) {
        return {
          classification: 'GAME',
          detectedPlatform: extPlatforms[0],
          confidenceScore: 0.90,
          confidence: 'HIGH'
        };
      }

      return {
        classification: 'GAME',
        detectedPlatform: pathPlatform || extPlatforms[0] || 'Retro',
        confidenceScore: pathPlatform ? 0.85 : 0.65,
        confidence: pathPlatform ? 'HIGH' : 'MEDIUM'
      };
    }

    // 3. Ambiguous formats requiring context
    if (ExtensionRegistry.isAmbiguous(ext)) {
      // 3.1 ISO Disc Images
      if (ext === '.iso') {
        if (pathPlatform && ['PlayStation 2', 'PSP', 'GameCube', 'Wii', 'Xbox', 'Xbox 360', 'PlayStation', 'PC', 'Dreamcast'].includes(pathPlatform)) {
          return {
            classification: 'GAME',
            detectedPlatform: pathPlatform,
            confidenceScore: pathPlatform === 'PC' ? 0.85 : 0.90,
            confidence: 'HIGH'
          };
        }
        // Generic ISO without console directory hint (could be OS install or generic data CD)
        return {
          classification: 'ARCHIVE',
          detectedPlatform: undefined,
          confidenceScore: 0.30,
          confidence: 'LOW'
        };
      }

      // 3.2 CUE Sheets
      if (ext === '.cue') {
        if (pathPlatform && ['PlayStation', 'Dreamcast', 'PlayStation 2', 'Retro'].includes(pathPlatform)) {
          return {
            classification: 'GAME',
            detectedPlatform: pathPlatform,
            confidenceScore: 0.90,
            confidence: 'HIGH'
          };
        }
        return {
          classification: 'GAME',
          detectedPlatform: 'PlayStation',
          confidenceScore: 0.60,
          confidence: 'MEDIUM'
        };
      }

      // 3.3 BIN Track files (standalone BIN has low confidence, usually part of BIN/CUE)
      if (ext === '.bin') {
        if (pathPlatform && ['PlayStation', 'PlayStation 2', 'Dreamcast', 'NES', 'SNES', 'Retro'].includes(pathPlatform)) {
          return {
            classification: 'GAME',
            detectedPlatform: pathPlatform,
            confidenceScore: 0.55,
            confidence: 'MEDIUM'
          };
        }
        return {
          classification: 'UNKNOWN',
          confidenceScore: 0.15,
          confidence: 'LOW'
        };
      }

      // 3.4 Archives (.zip, .7z, .rar)
      if (['.zip', '.7z', '.rar'].includes(ext)) {
        if (pathPlatform && pathPlatform !== 'PC' && pathPlatform !== 'Unknown') {
          // Inside a console ROM folder (e.g. /ROMs/SNES/Zelda.zip or /GBA/Pokemon.7z)
          return {
            classification: 'GAME',
            detectedPlatform: pathPlatform,
            confidenceScore: 0.85,
            confidence: 'HIGH'
          };
        }
        if (pathPlatform === 'PC') {
          return {
            classification: 'GAME',
            detectedPlatform: 'PC',
            confidenceScore: 0.70,
            confidence: 'MEDIUM'
          };
        }
        // Random unassociated zip/rar/7z
        return {
          classification: 'ARCHIVE',
          confidenceScore: 0.20,
          confidence: 'LOW'
        };
      }

      // 3.5 Executable (.exe)
      if (ext === '.exe') {
        if (pathPlatform === 'PC' && !filename.includes('setup') && !filename.includes('install') && !filename.includes('update')) {
          return {
            classification: 'GAME',
            detectedPlatform: 'PC',
            confidenceScore: 0.80,
            confidence: 'HIGH'
          };
        }
        // Random .exe outside designated PC game folders
        return {
          classification: 'UNKNOWN',
          confidenceScore: 0.10,
          confidence: 'LOW'
        };
      }

      // 3.6 PKG / ROM
      if (ext === '.pkg') {
        return {
          classification: 'GAME',
          detectedPlatform: pathPlatform || 'PlayStation 3',
          confidenceScore: pathPlatform === 'PlayStation 3' ? 0.90 : 0.60,
          confidence: pathPlatform === 'PlayStation 3' ? 'HIGH' : 'MEDIUM'
        };
      }

      if (ext === '.rom') {
        return {
          classification: 'GAME',
          detectedPlatform: pathPlatform || 'Retro',
          confidenceScore: pathPlatform ? 0.80 : 0.50,
          confidence: pathPlatform ? 'HIGH' : 'MEDIUM'
        };
      }
    }

    return {
      classification: 'UNKNOWN',
      confidenceScore: 0.05,
      confidence: 'LOW'
    };
  }

  public static classifyFile = FileClassifier.classify;
}
