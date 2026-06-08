import { ClaimListItem, ClaimVerdictApi } from '../../core/api/claim.models';
import {
  buildTimeline,
  normaliseQuarterKey,
  toClaimSummaries,
} from './claim-mapping';

function verdict(overrides: Partial<ClaimVerdictApi> = {}): ClaimVerdictApi {
  return {
    id: 'v-1',
    verdictType: 'DELIVERED',
    delta: '+5M (+1.0%)',
    confidenceScore: 0.91,
    isCorrection: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimListItem> = {}): ClaimListItem {
  return {
    id: 'c-1',
    quarter: 'Q3-2024',
    rawQuote: 'We expect MAU to reach 620M.',
    speaker: 'Daniel Ek',
    metric: 'MAU guidance',
    targetValue: '620M',
    targetUnit: 'users',
    extractionConfidence: 0.82,
    verdict: verdict(),
    ...overrides,
  };
}

describe('claim-mapping', () => {
  describe('toClaimSummaries', () => {
    it('maps a resolved claim to the presentation model', () => {
      const [summary] = toClaimSummaries([claim()]);
      expect(summary).toEqual({
        id: 'c-1',
        quarter: 'Q3 2024', // dash → space
        metric: 'MAU guidance',
        quote: 'We expect MAU to reach 620M.',
        speaker: 'Daniel Ek',
        verdict: 'DELIVERED',
        delta: '+5M (+1.0%)',
        confidence: 0.91, // verification confidence wins
      });
    });

    it('maps a pending claim (verdict null) to the PENDING verdict', () => {
      const [summary] = toClaimSummaries([claim({ verdict: null })]);
      expect(summary.verdict).toBe('PENDING');
      expect(summary.delta).toBeUndefined();
    });

    it('falls back to extraction confidence when there is no verdict', () => {
      const [summary] = toClaimSummaries([
        claim({ verdict: null, extractionConfidence: 0.7 }),
      ]);
      expect(summary.confidence).toBe(0.7);
    });

    it('falls back to extraction confidence when the verdict has no score', () => {
      const [summary] = toClaimSummaries([
        claim({
          extractionConfidence: 0.65,
          verdict: verdict({ confidenceScore: null }),
        }),
      ]);
      expect(summary.confidence).toBe(0.65);
    });

    it('falls back to a placeholder when speaker is null', () => {
      const [summary] = toClaimSummaries([claim({ speaker: null })]);
      expect(summary.speaker).toBe('Unknown speaker');
    });

    it('omits delta when the verdict carries none', () => {
      const [summary] = toClaimSummaries([
        claim({ verdict: verdict({ delta: null }) }),
      ]);
      expect(summary.delta).toBeUndefined();
    });

    it('sorts newest-first API order into oldest-first', () => {
      const order = toClaimSummaries([
        claim({ id: 'q4', quarter: 'Q4-2024' }),
        claim({ id: 'q1', quarter: 'Q1-2024' }),
        claim({ id: 'q2-23', quarter: 'Q2-2023' }),
      ]).map((c) => c.quarter);
      expect(order).toEqual(['Q2 2023', 'Q1 2024', 'Q4 2024']);
    });
  });

  describe('buildTimeline', () => {
    it('returns no columns for an empty claim list', () => {
      expect(buildTimeline([])).toEqual({ columns: [], keys: [] });
    });

    it('groups verdicts per quarter, oldest-first', () => {
      const { columns, keys } = buildTimeline([
        claim({ id: 'a', quarter: 'Q2-2024', verdict: verdict({ verdictType: 'MISSED' }) }),
        claim({ id: 'b', quarter: 'Q1-2024', verdict: verdict({ verdictType: 'DELIVERED' }) }),
        claim({ id: 'c', quarter: 'Q1-2024', verdict: null }),
      ]);
      expect(keys).toEqual(['Q1-2024', 'Q2-2024']);
      expect(columns[0].quarter).toBe('Q1 2024');
      expect(columns[0].verdicts).toEqual(['DELIVERED', 'PENDING']);
      expect(columns[1].verdicts).toEqual(['MISSED']);
    });

    it('inserts empty columns for gap quarters within the span', () => {
      const { columns, keys } = buildTimeline([
        claim({ id: 'a', quarter: 'Q1-2024' }),
        claim({ id: 'b', quarter: 'Q3-2024' }),
      ]);
      expect(keys).toEqual(['Q1-2024', 'Q2-2024', 'Q3-2024']);
      expect(columns[1].quarter).toBe('Q2 2024');
      expect(columns[1].verdicts).toEqual([]); // gap quarter → empty baseline
    });

    it('crosses a year boundary when filling gaps', () => {
      const { keys } = buildTimeline([
        claim({ id: 'a', quarter: 'Q3-2023' }),
        claim({ id: 'b', quarter: 'Q1-2024' }),
      ]);
      expect(keys).toEqual(['Q3-2023', 'Q4-2023', 'Q1-2024']);
    });

    it('shows the present quarters as-is rather than exceeding 8 columns', () => {
      // Q1-2022 → Q4-2024 gap-filled would be 12 columns; fall back to present.
      const { columns, keys } = buildTimeline([
        claim({ id: 'a', quarter: 'Q1-2022' }),
        claim({ id: 'b', quarter: 'Q4-2024' }),
      ]);
      expect(keys).toEqual(['Q1-2022', 'Q4-2024']);
      expect(columns.length).toBe(2);
    });
  });

  describe('normaliseQuarterKey', () => {
    it('accepts a well-formed quarter and upper-cases it', () => {
      expect(normaliseQuarterKey('q3-2024')).toBe('Q3-2024');
      expect(normaliseQuarterKey(' Q1-2023 ')).toBe('Q1-2023');
    });

    it('rejects malformed or absent values', () => {
      expect(normaliseQuarterKey('2024-Q3')).toBeNull();
      expect(normaliseQuarterKey('Q5-2024')).toBeNull();
      expect(normaliseQuarterKey('')).toBeNull();
      expect(normaliseQuarterKey(undefined)).toBeNull();
      expect(normaliseQuarterKey(null)).toBeNull();
    });
  });
});
