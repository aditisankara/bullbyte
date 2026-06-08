import {
  ClaimDetailApi,
  ClaimListItem,
  ReasoningTraceStepApi,
} from '../../core/api/claim.models';
import {
  ClaimDetail,
  ClaimSummary,
  QuarterColumn,
  TraceStep,
} from '../../shared/claim/claim';
import { Verdict } from '../../shared/verdict/verdict';

/**
 * Pure mappers from the Story 5.5 claims API DTO to the Story 2.4 presentation
 * models (`ClaimSummary`, `QuarterColumn`). This is the single reconciliation
 * seam for the four places the two contracts disagree:
 *
 *   1. pending verdict — API `verdict: null` ↔ presentation `Verdict = 'PENDING'`
 *   2. quarter format  — API `"Q3-2024"` (dash, the stable key) ↔ display `"Q3 2024"`
 *   3. speaker         — API `string | null` ↔ presentation required `string`
 *   4. confidence      — API split (`extractionConfidence` + `verdict.confidenceScore`)
 *                        ↔ presentation single `confidence` (0–1)
 *
 * Kept free of Angular so the edge cases are unit-tested without a TestBed.
 */

/** Number of quarters the timeline shows at most (FR31). */
export const MAX_TIMELINE_QUARTERS = 8;

const QUARTER_RE = /^Q([1-4])-(\d{4})$/;

/**
 * Validate/normalise a raw quarter string (e.g. a URL query param) to the
 * canonical `"Q3-2024"` key, or null if it is not a well-formed quarter.
 */
export function normaliseQuarterKey(raw: string | null | undefined): string | null {
  const key = raw?.trim().toUpperCase() ?? '';
  return QUARTER_RE.test(key) ? key : null;
}

/** Sortable ordinal for a canonical quarter key; malformed keys sort first. */
function quarterOrdinal(quarter: string): number {
  const m = QUARTER_RE.exec(quarter);
  if (!m) return -1;
  return Number(m[2]) * 4 + (Number(m[1]) - 1);
}

/** Inverse of `quarterOrdinal` — used to synthesise gap (empty) quarters. */
function quarterFromOrdinal(ordinal: number): string {
  return `Q${(ordinal % 4) + 1}-${Math.floor(ordinal / 4)}`;
}

/** `"Q3-2024"` → `"Q3 2024"` for display (the 2.4 model's label form). */
function displayQuarter(quarter: string): string {
  return quarter.replace('-', ' ');
}

/** Pending claims (`verdict: null`) become the `PENDING` tone (2.4 union). */
function verdictOf(item: ClaimListItem): Verdict {
  return item.verdict?.verdictType ?? 'PENDING';
}

/**
 * Verification confidence once a verdict carries one, else the extraction
 * confidence (a pending claim has no verification score yet). Both are 0–1.
 */
function confidenceOf(item: ClaimListItem): number {
  return item.verdict?.confidenceScore ?? item.extractionConfidence;
}

/** Map one API claim to the card's presentation model. */
export function toClaimSummary(item: ClaimListItem): ClaimSummary {
  return {
    id: item.id,
    quarter: displayQuarter(item.quarter),
    metric: item.metric,
    quote: item.rawQuote,
    speaker: item.speaker ?? 'Unknown speaker',
    verdict: verdictOf(item),
    delta: item.verdict?.delta ?? undefined,
    confidence: confidenceOf(item),
  };
}

/**
 * Map the API claim list to card summaries in chronological (oldest-first)
 * order — matching `DEFAULT_TIMELINE_DIRECTION`. The API returns newest-first,
 * so this re-sorts.
 */
export function toClaimSummaries(items: ClaimListItem[]): ClaimSummary[] {
  return [...items]
    .sort((a, b) => quarterOrdinal(a.quarter) - quarterOrdinal(b.quarter))
    .map(toClaimSummary);
}

/** Compose the claimed target with its unit, e.g. "620M users" (or just the value). */
function claimedValue(item: ClaimListItem): string {
  return item.targetUnit ? `${item.targetValue} ${item.targetUnit}` : item.targetValue;
}

/**
 * Best-effort tool name from the opaque jsonb `toolCall`. The real per-step
 * parsing (args + structured citations) is Story 6.6; here we just surface a
 * readable label for the collapsed trace.
 */
function toolLabel(toolCall: unknown): string {
  if (toolCall && typeof toolCall === 'object') {
    const o = toolCall as Record<string, unknown>;
    for (const key of ['tool', 'name', 'function'] as const) {
      const v = o[key];
      if (typeof v === 'string' && v) return v;
    }
  }
  return 'tool call';
}

/** Map one API trace step to a presentation step (basic; 6.6 deepens citations). */
function toTraceStep(step: ReasoningTraceStepApi): TraceStep {
  return {
    tool: toolLabel(step.toolCall),
    args: '',
    result: step.resultSummary ?? '',
    citation: step.edgarFilingRef
      ? { label: 'EDGAR filing', url: step.edgarFilingRef }
      : undefined,
  };
}

/**
 * Map the 5.5 claim-detail DTO to the 2.5 `ClaimDetailPanel` model. Five fields
 * the panel was designed for are not returned by 5.5 — `actual`, `actualFiling`,
 * and the source filing `type` — so they degrade: the smart panel hides the
 * claimed→actual comparison (`showComparison=false`) and the header delta
 * carries the quantitative outcome instead (FR37). `edgarSourceUrl: null`
 * yields an empty `filing.url`, which the panel renders as no source link.
 */
export function toClaimDetail(detail: ClaimDetailApi): ClaimDetail {
  return {
    ...toClaimSummary(detail),
    claimed: claimedValue(detail),
    actual: '', // 5.5 returns no actual value — comparison is hidden
    filing: { type: '', quarter: displayQuarter(detail.quarter), url: detail.edgarSourceUrl ?? '' },
    actualFiling: { type: '', quarter: '', url: '' }, // not returned by 5.5
    trace: detail.reasoningTrace.map(toTraceStep),
  };
}

/** The timeline columns plus their canonical quarter keys (parallel arrays). */
export interface Timeline {
  columns: QuarterColumn[];
  /** Canonical `"Q3-2024"` keys parallel to `columns` — the stable filter/URL key. */
  keys: string[];
}

/**
 * Build the oldest-first quarter columns for `app-promise-timeline`. The span
 * from the oldest to newest claim quarter is rendered contiguously, inserting
 * empty columns for quarters with no claims (the 2.4 timeline draws the empty
 * baseline). If gap-filling that span would exceed 8 columns, the present
 * quarters are shown as-is instead — so a claim-bearing quarter is never
 * dropped and the axis stays within FR31's 8-quarter cap.
 */
export function buildTimeline(items: ClaimListItem[]): Timeline {
  if (items.length === 0) return { columns: [], keys: [] };

  const verdictsByQuarter = new Map<string, Verdict[]>();
  for (const item of items) {
    const list = verdictsByQuarter.get(item.quarter) ?? [];
    list.push(verdictOf(item));
    verdictsByQuarter.set(item.quarter, list);
  }

  const present = [...verdictsByQuarter.keys()].sort(
    (a, b) => quarterOrdinal(a) - quarterOrdinal(b),
  );

  const filled: string[] = [];
  for (let ord = quarterOrdinal(present[0]); ord <= quarterOrdinal(present[present.length - 1]); ord++) {
    filled.push(quarterFromOrdinal(ord));
  }

  const keys = filled.length <= MAX_TIMELINE_QUARTERS ? filled : present;
  const columns = keys.map((key) => ({
    quarter: displayQuarter(key),
    verdicts: verdictsByQuarter.get(key) ?? [],
  }));

  return { columns, keys };
}
