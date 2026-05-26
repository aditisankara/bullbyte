import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Job } from 'bullmq';
import { firstValueFrom } from 'rxjs';
import { MlSidecarService } from '../common/ml-sidecar.service';
import { ANALYSIS_QUEUE, AnalysisJobData, JobsService } from './jobs.service';

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost {
	constructor(
		private readonly jobsService: JobsService,
		private readonly mlSidecar: MlSidecarService,
		@Inject(WINSTON_MODULE_NEST_PROVIDER)
		private readonly logger: LoggerService
	) {
		super();
	}

	async process(job: Job<AnalysisJobData>): Promise<void> {
		const { jobId, ticker } = job.data;

		await this.jobsService.markRunning(jobId); // AC2

		try {
			// Kicks off the sidecar run (it returns 202 quickly). The long-running
			// analysis reports progress + completion via the webhook in story 5.3 —
			// so we deliberately do NOT mark COMPLETED here. Job stays RUNNING.
			await firstValueFrom(this.mlSidecar.analyze(ticker));
		} catch (err) {
			await this.jobsService.markFailed(jobId); // AC4
			this.logger.error('Analysis job failed', {
				service: 'api',
				jobId,
				ticker,
				error: err instanceof Error ? err.message : String(err),
				timestamp: new Date().toISOString(),
			});
			throw err; // let BullMQ record the failed attempt
		}
	}
}
