/**
 * Direction of the CEO Delivery Score versus the prior window (FR24).
 */
export type ScoreTrend = 'up' | 'flat' | 'down';

/**
 * CEO Delivery Score presentation model. Aligns with the score output landing
 * in Stories 4.6 / 5.6; `trend` is supplied by comparing against the prior
 * window on the API side.
 */
export interface CeoScore {
  /** Delivery score on a 0–10 scale. */
  score: number;
  ceo: string;
  company?: string;
  /** Size of the sample window in quarters (FR23 sample-size context). */
  quarters: number;
  counts: {
    delivered: number;
    missed: number;
    pending: number;
    revised: number;
    insufficient?: number;
  };
  trend: ScoreTrend;
  /** Optional human label for the trend, e.g. "+0.6 vs. prior 8 quarters". */
  trendLabel?: string;
}

/** Resolved promises = delivered + missed (the only verdicts that count toward the score). */
export function resolvedCount(counts: CeoScore['counts']): number {
  return counts.delivered + counts.missed;
}
