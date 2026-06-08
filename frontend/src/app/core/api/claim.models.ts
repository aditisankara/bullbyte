/**
 * Frontend mirrors of the NestJS claims contract (Story 5.5). Field names and
 * unions must match `api/src/claims/dto/*` exactly — never invent values here.
 */

/**
 * Verdict types the API exposes on a claim. `PENDING` never appears here — a
 * pending claim is represented as `verdict: null` on the claim (5.5 AC1), so
 * the presentation layer maps that null to the `PENDING` verdict tone.
 */
export type ApiVerdictType =
  | 'DELIVERED'
  | 'MISSED'
  | 'INSUFFICIENT_DATA'
  | 'REVISED';

/** The effective (latest) verdict for a claim — mirrors `ClaimVerdictDto`. */
export interface ClaimVerdictApi {
  id: string;
  verdictType: ApiVerdictType;
  delta: string | null;
  confidenceScore: number | null; // numeric(4,3) parsed to number
  isCorrection: boolean;
  createdAt: string; // ISO8601
}

/** One claim on the timeline — mirrors `ClaimListItemDto`. */
export interface ClaimListItem {
  id: string;
  /** Canonical quarter, always `"Q3-2024"` (dash) format from the API. */
  quarter: string;
  rawQuote: string;
  speaker: string | null;
  metric: string;
  targetValue: string;
  targetUnit: string | null;
  extractionConfidence: number; // numeric(4,3) parsed to number
  verdict: ClaimVerdictApi | null; // null while the claim is pending
}

export interface ClaimListMeta {
  total: number; // claims inside the 8-quarter window
  page: number;
  pageSize: number;
}

/** `GET /api/v1/companies/:ticker/claims` envelope — mirrors `ClaimListResponseDto`. */
export interface ClaimListResponse {
  data: ClaimListItem[];
  meta: ClaimListMeta;
}

/**
 * One ordered step of the verification reasoning — mirrors `ReasoningTraceStepDto`.
 * `toolCall` is opaque jsonb (shape owned by the ML sidecar); the per-step
 * citation deepening is Story 6.6's concern.
 */
export interface ReasoningTraceStepApi {
  stepIndex: number | null;
  toolCall: unknown;
  resultSummary: string | null;
  edgarFilingRef: string | null;
}

/**
 * `GET /api/v1/claims/:claimId` — mirrors `ClaimDetailDto` (5.5). Extends the
 * list item with the EDGAR source URL, the low-confidence flag, and the trace.
 * The verdict is `null` while pending; `reasoningTrace` shows the steps so far.
 */
export interface ClaimDetailApi extends ClaimListItem {
  edgarSourceUrl: string | null;
  lowConfidence: boolean;
  reasoningTrace: ReasoningTraceStepApi[];
}
