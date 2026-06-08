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

/** A reference to a source filing on SEC EDGAR (FR38). */
export interface FilingRef {
  /** Filing type, e.g. "8-K", "10-K". */
  type: string;
  /** Quarter the filing pertains to, e.g. "Q1 2024". */
  quarter: string;
  /** Direct EDGAR URL. */
  url: string;
}

/**
 * One ordered step of the agent reasoning trace (FR39). `citation` is the
 * inline EDGAR (or other source) link backing this step's result. Aligns with
 * the reasoning-trace output landing in Stories 4.5 / 5.5.
 */
export interface TraceStep {
  tool: string;
  args: string;
  result: string;
  citation?: { label: string; url: string };
  /** The step the verification stopped at (INSUFFICIENT_DATA) — rendered as the
   *  distinct failure/end-of-trace step (6.6, FR39 AC4). */
  failure?: boolean;
}

/**
 * Full detail for a single claim, shown in the ClaimDetailPanel. Extends the
 * card summary with the claimed→actual values, the source filings, and the
 * reasoning trace.
 */
export interface ClaimDetail extends ClaimSummary {
  /** The value the executive claimed, e.g. "620M". */
  claimed: string;
  /** What actually happened, e.g. "602M". */
  actual: string;
  /** EDGAR filing the claim was sourced from. */
  filing: FilingRef;
  /** EDGAR filing the actual was verified against. */
  actualFiling: FilingRef;
  trace: TraceStep[];
}
