import { CloudFile, GameCandidate } from '../core/types';
import { FileClassifier } from './FileClassifier';
import { ExtensionRegistry } from './ExtensionRegistry';

export class GameCandidateResolver {
  /**
   * Cleans game title by removing release tags, regions, and technical markers.
   * Preserves game subtitles and original character casing.
   */
  public static normalizeTitle(rawName: string): string {
    // Strip file extension if present
    const ext = ExtensionRegistry.normalizeExtension(rawName);
    let title = ext ? rawName.slice(0, -ext.length) : rawName;

    // Replace underscores with spaces
    title = title.replace(/_/g, ' ');

    // Replace dots with spaces only if surrounded by alphanumeric words (e.g. Gran.Turismo -> Gran Turismo)
    title = title.replace(/([a-zA-Z0-9])\.([a-zA-Z0-9])/g, ' ');

    // Remove common brackets and release tags: (USA), [USA], (En,Fr), (v1.0), [!], etc.
    title = title
      .replace(/\s*\([^)]*(usa|europe|japan|world|en|fr|de|es|it|pt|rev\s*\d+|v\s*\d+(\.\d+)?|beta|proto|unl)[^)]*\)/gi, '')
      .replace(/\s*\[[^\]]*(usa|europe|japan|world|!|b\d+|h\d+|t\d+)[^\]]*\]/gi, '')
      .replace(/\s*\((disc|cd|part)\s*\d+[^)]*\)/gi, '') // Strip disc tags from primary display title
      .replace(/\s*\[(disc|cd|part)\s*\d+[^\]]*\]/gi, '');

    // Normalize spacing
    title = title.replace(/\s+/g, ' ').trim();

    return title || rawName;
  }

  /**
   * Extracts disc index from title or filename (e.g. Disc 1 -> 1).
   */
  public static extractDiscIndex(filename: string): number | undefined {
    const match = filename.match(/(?:disc|cd|part)\s*(\d+)/i);
    if (match && match[1]) {
      const idx = parseInt(match[1], 10);
      return isNaN(idx) ? undefined : idx;
    }
    return undefined;
  }

  /**
   * Processes a list of CloudFiles from an account and groups related files
   * (e.g. BIN/CUE, multi-track, multi-disc) into coherent GameCandidates.
   */
  public static resolveCandidates(files: CloudFile[]): GameCandidate[] {
    const candidates: GameCandidate[] = [];

    // Filter out folders and trashed files
    const validFiles = files.filter((f) => !f.isFolder && !f.trashed);

    // Group files by directory path
    const byDirectory = new Map<string, CloudFile[]>();
    for (const file of validFiles) {
      const dir = file.remotePath ? file.remotePath.substring(0, file.remotePath.lastIndexOf('/')) : '/';
      if (!byDirectory.has(dir)) {
        byDirectory.set(dir, []);
      }
      byDirectory.get(dir)!.push(file);
    }

    // Process each directory
    for (const [, dirFiles] of byDirectory.entries()) {
      // 1. Group BIN/CUE pairs in the directory
      const cues = dirFiles.filter((f) => f.extension.toLowerCase() === '.cue');
      const bins = dirFiles.filter((f) => f.extension.toLowerCase() === '.bin');
      const handledFileIds = new Set<string>();

      for (const cue of cues) {
        const classification = FileClassifier.classify(cue);
        if (classification.classification !== 'GAME') continue;

        const cueStem = cue.name.replace(/\.cue$/i, '').trim();
        // Find associated bin files in same directory (Track 01, Track 02 or matching stem)
        const associatedBins = bins.filter((b) => {
          const bStem = b.name.replace(/\.bin$/i, '').trim();
          return (
            bStem === cueStem ||
            bStem.startsWith(cueStem) ||
            /track\s*\d+/i.test(b.name) ||
            dirFiles.length <= 10 // small single-game directory
          );
        });

        for (const b of associatedBins) {
          handledFileIds.add(b.id);
        }
        handledFileIds.add(cue.id);

        const normTitle = this.normalizeTitle(cue.name);
        const discIndex = this.extractDiscIndex(cue.name);

        candidates.push({
          primaryFile: cue,
          additionalFiles: associatedBins,
          candidateTitle: cueStem,
          normalizedTitle: normTitle,
          platform: classification.detectedPlatform || 'PlayStation',
          confidence: classification.confidence,
          confidenceScore: classification.confidenceScore,
          discIndex
        });
      }

      // 2. Process remaining files in directory
      for (const file of dirFiles) {
        if (handledFileIds.has(file.id)) continue;

        const classification = FileClassifier.classify(file);
        if (classification.classification !== 'GAME') continue;

        // Skip standalone orphan bin tracks if a cue was present in directory
        if (file.extension.toLowerCase() === '.bin' && /track\s*\d+/i.test(file.name) && cues.length > 0) {
          continue;
        }

        const normTitle = this.normalizeTitle(file.name);
        const discIndex = this.extractDiscIndex(file.name);

        candidates.push({
          primaryFile: file,
          additionalFiles: [],
          candidateTitle: file.name.slice(0, -(file.extension.length || 0)),
          normalizedTitle: normTitle,
          platform: classification.detectedPlatform || 'Unknown',
          confidence: classification.confidence,
          confidenceScore: classification.confidenceScore,
          discIndex
        });
      }
    }

    return candidates;
  }
}
