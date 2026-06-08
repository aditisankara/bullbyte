import {
  ClaimDetailApi,
  ClaimListItem,
  ClaimVerdictApi,
} from '../../core/api/claim.models';
import {
  buildTimeline,
  normaliseQuarterKey,
  toClaimDetail,
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

  describe('toClaimDetail', () => {
    function detail(overrides: Partial<ClaimDetailApi> = {}): ClaimDetailApi {
      return {
        ...claim(),
        edgarSourceUrl: 'https://www.sec.gov/edgar/tsla-8k',
        lowConfidence: false,
        reasoningTrace: [],
        ...overrides,
      };
    }

    it('carries the summary fields and composes the claimed value with its unit', () => {
      const d = toClaimDetail(detail());
      expect(d.quarter).toBe('Q3 2024');
      expect(d.quote).toBe('We expect MAU to reach 620M.');
      expect(d.verdict).toBe('DELIVERED');
      expect(d.claimed).toBe('620M users');
    });

    it('hides the comparison fields the 5.5 API does not return', () => {
      const d = toClaimDetail(detail());
      expect(d.actual).toBe('');
      expect(d.actualFiling).toEqual({ type: '', quarter: '', url: '' });
      // delta still carries the quantitative outcome (FR37)
      expect(d.delta).toBe('+5M (+1.0%)');
    });

    it('maps the EDGAR source url into the filing (no type from the API)', () => {
      const d = toClaimDetail(detail());
      expect(d.filing.url).toBe('https://www.sec.gov/edgar/tsla-8k');
      expect(d.filing.quarter).toBe('Q3 2024');
      expect(d.filing.type).toBe('');
    });

    it('yields an empty filing url when edgarSourceUrl is null', () => {
      expect(toClaimDetail(detail({ edgarSourceUrl: null })).filing.url).toBe('');
    });

    it('maps trace steps, deriving the tool label and an EDGAR citation', () => {
      const d = toClaimDetail(
        detail({
          reasoningTrace: [
            {
              stepIndex: 0,
              toolCall: { tool: 'fetch_filing' },
              resultSummary: 'Found the 8-K',
              edgarFilingRef: 'https://www.sec.gov/edgar/tsla-8k',
            },
            {
              stepIndex: 1,
              toolCall: 'opaque',
              resultSummary: null,
              edgarFilingRef: null,
            },
          ],
        }),
      );
      expect(d.trace[0]).toEqual({
        tool: 'fetch_filing',
        args: '',
        result: 'Found the 8-K',
        citation: { label: 'EDGAR filing', url: 'https://www.sec.gov/edgar/tsla-8k' },
      });
      // unparseable toolCall → generic label; no citation when no filing ref
      expect(d.trace[1].tool).toBe('tool call');
      expect(d.trace[1].result).toBe('');
      expect(d.trace[1].citation).toBeUndefined();
    });

    it('maps a pending claim (verdict null) to the PENDING tone', () => {
      expect(toClaimDetail(detail({ verdict: null })).verdict).toBe('PENDING');
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
