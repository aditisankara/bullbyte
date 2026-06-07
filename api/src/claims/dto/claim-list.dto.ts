import { ClaimVerdictDto } from './claim-verdict.dto';

/** One claim on the timeline (AC1). `quarter` is always "Q3-2024" format. */
export interface ClaimListItemDto {
	id: string;
	quarter: string;
	rawQuote: string;
	speaker: string | null;
	metric: string;
	targetValue: string;
	targetUnit: string | null;
	extractionConfidence: number; // numeric(4,3) parsed to number
	verdict: ClaimVerdictDto | null; // null while the claim is pending
}

export interface ClaimListMetaDto {
	total: number; // claims inside the 8-quarter window
	page: number;
	pageSize: number;
}

/** `GET /api/v1/companies/:ticker/claims` envelope (AC1, AC4). */
export interface ClaimListResponseDto {
	data: ClaimListItemDto[];
	meta: ClaimListMetaDto;
}
