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
  latestJobId: string | null; // id of the most recent analysis job, or null (6.2: SSE resume on direct load)
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

/**
 * `GET /api/v1/companies/:ticker/score` — mirrors the API's `CeoScoreDto` (5.6).
 * Wire shape only; the 2.6 presentation model lives in `shared/score/ceo-score.ts`
 * and the 6.4 smart card adapts between them.
 *
 * `score` is `deliveredCount / totalResolved` on a **0–1** scale (not 0–10), or
 * `null` — never 0 — when no verdicts have resolved. `context` is always present.
 */
export interface CeoScoreDto {
  ticker: string;
  score: number | null;
  deliveredCount: number;
  missedCount: number;
  totalResolved: number; // deliveredCount + missedCount only
  pendingCount: number;
  insufficientDataCount: number;
  context: string;
}
