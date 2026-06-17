import {
	BadRequestException,
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	Post,
	UseGuards,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { InternalWebhookGuard } from '../common/guards/internal-webhook.guard';
import { ProgressService } from './progress.service';
import { JobsService } from './jobs.service';
import { ProgressWebhookDto } from './dto/progress-webhook.dto';

/**
 * Internal webhook receiver (story 5.3). FastAPI POSTs one event per agent step;
 * NestJS relays it verbatim to the active SSE stream for that job.
 *
 * Mounted at `/internal/jobs/:jobId/progress` — the `internal` prefix is excluded
 * from the global `api/v1` prefix in main.ts, matching NESTJS_WEBHOOK_URL.
 * Guarded by a shared-secret header (NFR13/NFR14).
 */
@Controller('internal/jobs')
@UseGuards(InternalWebhookGuard)
export class InternalWebhookController {
	constructor(
		private readonly progress: ProgressService,
		private readonly jobs: JobsService,
		@Inject(WINSTON_MODULE_NEST_PROVIDER)
		private readonly logger: LoggerService
	) {}

	/**
	 * POST /internal/jobs/:jobId/progress
	 * 202 ACCEPTED regardless of whether a client is listening — a missing SSE
	 * subscriber is a no-op, never an error to FastAPI (AC3).
	 */
	@Post(':jobId/progress')
	@HttpCode(HttpStatus.ACCEPTED)
	async relay(
		@Param('jobId') jobId: string,
		@Body() event: ProgressWebhookDto
	): Promise<void> {
		if (event.jobId !== jobId) {
			throw new BadRequestException(
				'jobId in path does not match jobId in body'
			);
		}

		// Persist terminal status BEFORE broadcasting so that any SSE reconnect
		// that fires after the browser receives the terminal event will see the
		// correct DB state in terminalSnapshot() and won't hang on an empty Subject.
		if (event.event === 'analysis-complete') {
			await this.jobs.markCompleted(jobId);
		} else if (event.event === 'analysis-failed') {
			await this.jobs.markFailed(jobId);
		}

		// Relayed untouched (AC2: no transformation).
		this.progress.publish(event);

		this.logger.log('Progress webhook relayed', {
			service: 'api',
			jobId: event.jobId,
			event: event.event,
			stepIndex: event.stepIndex,
			timestamp: event.timestamp,
		});
	}
}
