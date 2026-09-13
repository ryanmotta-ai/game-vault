import { GameIdentityQuery, MetadataCandidate, MatchConfidence } from '../core/types';
import { MetadataPlatformMapper } from './MetadataPlatformMapper';

export class MetadataCandidateScorer {
  /**
   * Computes normalized title similarity (0 to 100) using token overlap and Levenshtein distance.
   */
  public static calculateTitleSimilarity(a: string, b: string): number {
    const normA = this.normalizeTitleForComparison(a);
    const normB = this.normalizeTitleForComparison(b);

    if (!normA || !normB) return 0;
    if (normA === normB) return 100;

    // Substring match
    if (normA.includes(normB) || normB.includes(normA)) {
      const shorter = Math.min(normA.length, normB.length);
      const longer = Math.max(normA.length, normB.length);
      const ratio = shorter / longer;
      return Math.round(75 + ratio * 20); // 75 - 95
    }

    // Levenshtein distance
    const distance = this.levenshtein(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);
    const score = Math.max(0, Math.round((1 - distance / maxLen) * 100));
    return score;
  }

  private static normalizeTitleForComparison(t: string): string {
    return t
      .toLowerCase()
      .replace(/[:\-–—_.,'!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static levenshtein(s: string, t: string): number {
    const m = s.length;
    const n = t.length;
    const d: number[][] = [];

    for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i][j] = Math.min(
          d[i - 1][j] + 1, // deletion
          d[i][j - 1] + 1, // insertion
          d[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return d[m][n];
  }

  /**
   * Scores an individual candidate against a GameIdentityQuery.
   */
  public static scoreCandidate(
    query: GameIdentityQuery,
    candidate: Omit<MetadataCandidate, 'matchSignals' | 'totalScore' | 'confidence'> & {
      serial?: string;
      hash?: string;
    }
  ): MetadataCandidate {
    // 1. Hash exact match
    if (query.md5 && candidate.hash && query.md5.toLowerCase() === candidate.hash.toLowerCase()) {
      return {
        ...candidate,
        matchSignals: {
          titleScore: 100,
          platformMatch: true,
          hashMatch: true
        },
        totalScore: 100,
        confidence: 'EXACT'
      };
    }

    // 2. Serial exact match
    if (query.serial && candidate.serial && query.serial.toUpperCase() === candidate.serial.toUpperCase()) {
      return {
        ...candidate,
        matchSignals: {
          titleScore: 95,
          platformMatch: true,
          serialMatch: true
        },
        totalScore: 95,
        confidence: 'EXACT'
      };
    }

    // 3. Platform match
    let platformMatch = false;
    if (candidate.platform) {
      const candidateNormPlatform = MetadataPlatformMapper.toGamePlatform(candidate.platform);
      const queryNormPlatform = MetadataPlatformMapper.toGamePlatform(query.platform);
      platformMatch = candidateNormPlatform === queryNormPlatform;
    } else {
      // If provider didn't return platform, assume neutral match
      platformMatch = true;
    }

    // 4. Title similarity
    const titleScore = this.calculateTitleSimilarity(query.cleanTitle, candidate.title);

    // 5. Region match
    let regionMatch = false;
    if (query.region && candidate.region) {
      regionMatch = query.region.toUpperCase() === candidate.region.toUpperCase();
    }

    // 6. Year match
    let yearMatch = false;
    if (query.releaseYearHint && candidate.releaseYear) {
      yearMatch = Math.abs(query.releaseYearHint - candidate.releaseYear) <= 1;
    }

    // If platform is known and completely mismatches, penalize heavily
    if (candidate.platform && !platformMatch) {
      const penalizedScore = Math.min(30, Math.round(titleScore * 0.3));
      return {
        ...candidate,
        matchSignals: {
          titleScore,
          platformMatch: false,
          regionMatch,
          yearMatch
        },
        totalScore: penalizedScore,
        confidence: 'LOW'
      };
    }

    // Base score from title (up to 85)
    let totalScore = Math.round(titleScore * 0.85);

    // Platform bonus (+10 if verified)
    if (platformMatch) totalScore += 10;

    // Region bonus (+5)
    if (regionMatch) totalScore += 5;

    // Year bonus (+5)
    if (yearMatch) totalScore += 5;

    totalScore = Math.min(100, Math.max(0, totalScore));

    // Confidence classification
    let confidence: MatchConfidence = 'LOW';
    if (totalScore >= 95 || (titleScore === 100 && platformMatch)) {
      confidence = 'EXACT';
    } else if (totalScore >= 80) {
      confidence = 'HIGH';
    } else if (totalScore >= 60) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }

    return {
      ...candidate,
      matchSignals: {
        titleScore,
        platformMatch,
        regionMatch,
        yearMatch
      },
      totalScore,
      confidence
    };
  }
}
