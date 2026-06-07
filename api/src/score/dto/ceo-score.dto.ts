import { verdictTypeEnum } from '../../db/schema';

/** Canonical verdict type, derived from the locked Drizzle enum (SP2). */
export type VerdictType = (typeof verdictTypeEnum.enumValues)[number];

/**
 * CEO Delivery Score with sample-size context (FR22, FR23). All camelCase (AC1).
 * `score` is null — never 0 — when no resolved verdicts exist; `context` is
 * always present (format parity with the ML sidecar's 4.6 contextMessage).
 */
export interface CeoScoreDto {
	ticker: string;
	score: number | null; // deliveredCount / totalResolved, or null
	deliveredCount: number;
	missedCount: number;
	totalResolved: number; // deliveredCount + missedCount only
	pendingCount: number;
	insufficientDataCount: number;
	context: string;
}
