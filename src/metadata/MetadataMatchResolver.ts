import { MetadataCandidate, MatchConfidence } from '../core/types';

export interface MatchResolution {
  bestMatch: MetadataCandidate | null;
  candidates: MetadataCandidate[];
  confidence: MatchConfidence;
  requiresReview: boolean;
  reason: string;
}

export class MetadataMatchResolver {
  /**
   * Resolves a list of scored candidates to determine whether an automatic match can be applied
   * or if the match requires manual user review.
   */
  public static resolve(scoredCandidates: MetadataCandidate[]): MatchResolution {
    if (!scoredCandidates || scoredCandidates.length === 0) {
      return {
        bestMatch: null,
        candidates: [],
        confidence: 'LOW',
        requiresReview: false,
        reason: 'No candidates found'
      };
    }

    // Sort by totalScore descending
    const sorted = [...scoredCandidates].sort((a, b) => b.totalScore - a.totalScore);
    const top = sorted[0];

    // Single candidate
    if (sorted.length === 1) {
      if (top.confidence === 'EXACT' || top.confidence === 'HIGH') {
        return {
          bestMatch: top,
          candidates: sorted,
          confidence: top.confidence,
          requiresReview: false,
          reason: `High confidence match (${top.totalScore}%)`
        };
      }
      return {
        bestMatch: top,
        candidates: sorted,
        confidence: top.confidence,
        requiresReview: true,
        reason: `Single candidate with ${top.confidence} confidence (${top.totalScore}%) requires review`
      };
    }

    const second = sorted[1];
    const scoreDiff = top.totalScore - second.totalScore;

    // Check for ambiguous competitors (e.g. Sonic 2 Genesis vs Sonic 2 Game Gear or Prologue)
    if (scoreDiff < 5 && top.confidence !== 'EXACT') {
      const ambiguousTop: MetadataCandidate = {
        ...top,
        confidence: 'AMBIGUOUS'
      };
      return {
        bestMatch: ambiguousTop,
        candidates: sorted,
        confidence: 'AMBIGUOUS',
        requiresReview: true,
        reason: `Ambiguous match: top candidates separated by only ${scoreDiff} points`
      };
    }

    // Top is EXACT
    if (top.confidence === 'EXACT') {
      return {
        bestMatch: top,
        candidates: sorted,
        confidence: 'EXACT',
        requiresReview: false,
        reason: `Exact match found (${top.totalScore}%)`
      };
    }

    // Top is HIGH with comfortable margin
    if (top.confidence === 'HIGH' && scoreDiff >= 10) {
      return {
        bestMatch: top,
        candidates: sorted,
        confidence: 'HIGH',
        requiresReview: false,
        reason: `High confidence match with ${scoreDiff} point margin over runner-up`
      };
    }

    // Top is MEDIUM or small margin
    return {
      bestMatch: top,
      candidates: sorted,
      confidence: top.confidence === 'HIGH' ? 'MEDIUM' : top.confidence,
      requiresReview: true,
      reason: `Match confidence ${top.confidence} (${top.totalScore}%) requires user confirmation`
    };
  }
}
