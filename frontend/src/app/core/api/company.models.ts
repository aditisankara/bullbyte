/**
 * Frontend mirrors of the NestJS API contracts (5.1 + 5.4). Field names and
 * unions must match the API DTOs exactly — never invent values here.
 */

/** Canonical job status union — mirrors the locked Drizzle `job_status` enum. */
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** The 4-state loading union (UX-DR: never a boolean `isLoading`). */
export type LoadState = 'idle' | 'loading' | 'success' | 'error';

/** `GET /api/v1/companies/:ticker` — mirrors `CompanySummaryDto`. */
export interface CompanySummary {
  id: string;
  ticker: string;
  name: string;
  lastAnalysedAt: string | null; // ISO8601, or null if never analysed
  jobStatus: JobStatus | null; // status of the most recent analysis job, or null
}

export interface QueuedAnalyzeResponse {
  jobId: string;
  status: 'QUEUED';
}

export interface CachedAnalyzeResponse {
  jobId: null;
  status: 'COMPLETED';
  cached: true;
}

/**
 * `POST /api/v1/companies/:ticker/analyze` — mirrors `AnalyzeResponseDto`.
 * Discriminated on `status`: 202 for a freshly queued job, 200 for a cache hit.
 */
export type AnalyzeResponse = QueuedAnalyzeResponse | CachedAnalyzeResponse;
