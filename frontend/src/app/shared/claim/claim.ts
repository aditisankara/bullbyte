import { Verdict } from '../verdict/verdict';

/**
 * Presentation model for a single verified claim, as shown on a ClaimCard.
 *
 * Aligns with the Epic-5 claim DTO landing in Story 5.5; `speaker` (attribution)
 * is added here per the 2.4 gap analysis and must be carried through on the API
 * side when 5.5 lands.
 */
export interface ClaimSummary {
  id: string;
  /** Formatted quarter label, e.g. "Q1 2024". */
  quarter: string;
  /** Short metric summary, e.g. "MAU guidance". */
  metric: string;
  /** The forward-looking quote from the earnings call. */
  quote: string;
  /** Speaker attribution, e.g. "Daniel Ek · CEO". */
  speaker: string;
  verdict: Verdict;
  /** Signed delta string, e.g. "−18M (−2.9%)". Absent when not applicable. */
  delta?: string;
  /** Verification confidence in the range 0–1. */
  confidence: number;
}

/**
 * One column of the promise timeline: a quarter and the verdicts of the claims
 * made in it. An empty `verdicts` array represents a quarter with no claims.
 */
export interface QuarterColumn {
  /** Formatted quarter label, e.g. "Q1 2024". */
  quarter: string;
  verdicts: Verdict[];
}
