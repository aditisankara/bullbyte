import { ClaimListItemDto } from './claim-list.dto';

/** One ordered step of the verification agent's reasoning (FR36–FR39). */
export interface ReasoningTraceStepDto {
	stepIndex: number | null;
	toolCall: unknown; // jsonb payload, shape owned by the ML sidecar
	resultSummary: string | null;
	edgarFilingRef: string | null;
}

/**
 * `GET /api/v1/claims/:claimId` (AC2, AC3). Served entirely from PostgreSQL.
 * `reasoningTrace` reflects the latest verdicts row even while the claim is
 * pending (`verdict: null`) — the steps taken so far stay visible.
 */
export interface ClaimDetailDto extends ClaimListItemDto {
	edgarSourceUrl: string | null; // transcripts.filing_url for (ticker, quarter)
	lowConfidence: boolean; // FR40 — flag only; the verdict is never withheld
	reasoningTrace: ReasoningTraceStepDto[];
}
