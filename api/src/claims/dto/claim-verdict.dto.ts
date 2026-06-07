import { verdictTypeEnum } from '../../db/schema';

/**
 * Verdict types the API exposes. PENDING never appears — a pending claim is
 * represented as `verdict: null` (AC1), so consumers need exactly one check.
 */
export type PublicVerdictType = Exclude<
	(typeof verdictTypeEnum.enumValues)[number],
	'PENDING'
>;

/** The effective (latest) verdict for a claim. All fields camelCase. */
export interface ClaimVerdictDto {
	id: string;
	verdictType: PublicVerdictType;
	delta: string | null;
	confidenceScore: number | null; // numeric(4,3) parsed to number
	isCorrection: boolean;
	createdAt: string; // ISO8601
}
