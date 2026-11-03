import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { analysisJobs, companies } from '../db/schema';
import { AnalyzeResponseDto, JobStatus } from './dto/analyze-response.dto';

export const ANALYSIS_QUEUE = 'analysis';

/** A COMPLETED analysis is served from cache for this long before it is refreshed. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** A QUEUED/RUNNING job older than this is treated as orphaned. */
const STALE_JOB_MS = 20 * 60 * 1000;

export interface AnalysisJobData {
	jobId: string;
	ticker: string;
}

@Injectable()
export class JobsService {
	constructor(
		@Inject(DRIZZLE) private readonly db: DrizzleDB,
		@InjectQueue(ANALYSIS_QUEUE)
		private readonly queue: Queue<AnalysisJobData>
	) {}

	/**
	 * AC1/AC3: cache hit short-circuits. A job already QUEUED/RUNNING for this
	 * ticker is returned as-is rather than spawning a duplicate — without this,
	 * a retriggered analyze (retry button, repeated search) piles a second
	 * extraction run on top of the first and writes duplicate claims.
	 */
	async requestAnalysis(ticker: string): Promise<AnalyzeResponseDto> {
		const companyId = await this.ensureCompany(ticker);

		const latest = await this.latestJob(companyId);
		if (
			latest?.status === 'COMPLETED' &&
			Date.now() - latest.createdAt.getTime() < CACHE_TTL_MS
		) {
			return { jobId: null, status: 'COMPLETED', cached: true };
		}
		// An older COMPLETED job falls through to a fresh run: claims that were
		// PENDING (filing not yet published) get re-verified, and new filings are picked up.
		if (latest?.status === 'QUEUED' || latest?.status === 'RUNNING') {
			if (Date.now() - latest.createdAt.getTime() < STALE_JOB_MS) {
				return { jobId: latest.id, status: latest.status };
			}
			// Orphaned run (lost terminal webhook, sidecar restart): fail it so the
			// ticker can be re-analysed instead of showing "in progress" forever.
			await this.markFailed(latest.id);
		}

		// Persist the job row first so its id is the source of truth, then enqueue
		// carrying that id. The BullMQ job is persisted to Redis (survives restart, AC1).
		const [job] = await this.db
			.insert(analysisJobs)
			.values({ companyId, status: 'QUEUED' })
			.returning({ id: analysisJobs.id });

		await this.queue.add(ANALYSIS_QUEUE, { jobId: job.id, ticker });

		return { jobId: job.id, status: 'QUEUED' };
	}

	/**
	 * Minimal insert-if-missing. Full company CRUD + name resolution is story 5.4 —
	 * reuse this helper there rather than duplicating the upsert.
	 */
	private async ensureCompany(ticker: string): Promise<string> {
		const [existing] = await this.db
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.ticker, ticker))
			.limit(1);
		if (existing) return existing.id;

		const [created] = await this.db
			.insert(companies)
			.values({ ticker, name: ticker }) // TODO(5.4): resolve the real company name
			.onConflictDoNothing({ target: companies.ticker })
			.returning({ id: companies.id });
		if (created) return created.id;

		// Lost an insert race against a concurrent request — re-read (NFR11).
		const [row] = await this.db
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.ticker, ticker))
			.limit(1);
		return row.id;
	}

	/** The company's most recent job, if any. */
	private async latestJob(
		companyId: string
	): Promise<{ id: string; status: JobStatus; createdAt: Date } | undefined> {
		const [latest] = await this.db
			.select({
				id: analysisJobs.id,
				status: analysisJobs.status,
				createdAt: analysisJobs.createdAt,
			})
			.from(analysisJobs)
			.where(eq(analysisJobs.companyId, companyId))
			.orderBy(desc(analysisJobs.createdAt))
			.limit(1);
		return latest;
	}

	/** AC2: worker dispatched the run to the sidecar. */
	markRunning(jobId: string): Promise<void> {
		return this.setStatus(jobId, 'RUNNING');
	}

	/** Called by the internal webhook when FastAPI sends analysis-complete. */
	async markCompleted(jobId: string): Promise<void> {
		await this.setStatus(jobId, 'COMPLETED');
		const [job] = await this.db
			.select({ companyId: analysisJobs.companyId })
			.from(analysisJobs)
			.where(eq(analysisJobs.id, jobId))
			.limit(1);
		if (job) {
			await this.db
				.update(companies)
				.set({ lastAnalysedAt: new Date() })
				.where(eq(companies.id, job.companyId));
		}
	}

	/**
	 * AC4: sidecar failed. NOTE: `analysis_jobs` has no error column (schema locked,
	 * SP1) — the error reason is carried in the structured log emitted by the
	 * processor, not stored on the row. Flag to the team if persistence is needed.
	 */
	markFailed(jobId: string): Promise<void> {
		return this.setStatus(jobId, 'FAILED');
	}

	// Single choke point: only canonical SCREAMING_SNAKE_CASE enum values are ever
	// written to analysis_jobs.status (AC5). The JobStatus type is enforced at compile time.
	private async setStatus(jobId: string, status: JobStatus): Promise<void> {
		await this.db
			.update(analysisJobs)
			.set({ status })
			.where(eq(analysisJobs.id, jobId));
	}
}
