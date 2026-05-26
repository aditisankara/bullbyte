import { jobStatusEnum } from '../../db/schema';

/**
 * Canonical job status union, derived from the locked Drizzle enum (SP2).
 * Never re-declare these string literals — import this type instead.
 */
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

export interface QueuedAnalyzeResponse {
	jobId: string;
	status: 'QUEUED';
}

export interface CachedAnalyzeResponse {
	jobId: null;
	status: 'COMPLETED';
	cached: true;
}

/** Discriminated on `status`: 202 for a freshly queued job, 200 for a cache hit. */
export type AnalyzeResponseDto = QueuedAnalyzeResponse | CachedAnalyzeResponse;
