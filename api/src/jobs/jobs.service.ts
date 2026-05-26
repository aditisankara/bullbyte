import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { analysisJobs, companies } from '../db/schema';
import { AnalyzeResponseDto, JobStatus } from './dto/analyze-response.dto';

export const ANALYSIS_QUEUE = 'analysis';

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

	/** AC1/AC3: cache hit short-circuits; otherwise create QUEUED job + enqueue. */
	async requestAnalysis(ticker: string): Promise<AnalyzeResponseDto> {
		const companyId = await this.ensureCompany(ticker);

		if (await this.isCached(companyId)) {
			return { jobId: null, status: 'COMPLETED', cached: true };
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

	/**
	 * Phase 1 cache definition: the company's most recent job is COMPLETED.
	 * TODO(3.6/5.5): tighten to "transcripts + verdicts present for requested quarters".
	 */
	private async isCached(companyId: string): Promise<boolean> {
		const [latest] = await this.db
			.select({ status: analysisJobs.status })
			.from(analysisJobs)
			.where(eq(analysisJobs.companyId, companyId))
			.orderBy(desc(analysisJobs.createdAt))
			.limit(1);
		return latest?.status === 'COMPLETED';
	}

	/** AC2: worker dispatched the run to the sidecar. */
	markRunning(jobId: string): Promise<void> {
		return this.setStatus(jobId, 'RUNNING');
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
