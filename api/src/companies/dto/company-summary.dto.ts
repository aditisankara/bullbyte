import { jobStatusEnum } from '../../db/schema';

/** Canonical job status, derived from the locked Drizzle enum (SP2). */
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

/** Top-level company summary for the dashboard. All fields camelCase (AC1). */
export interface CompanySummaryDto {
	id: string;
	ticker: string;
	name: string;
	lastAnalysedAt: string | null; // ISO8601, or null if never analysed
	jobStatus: JobStatus | null; // status of the most recent analysis job, or null
}
