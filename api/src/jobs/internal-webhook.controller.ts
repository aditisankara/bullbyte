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
	relay(
		@Param('jobId') jobId: string,
		@Body() event: ProgressWebhookDto
	): void {
		if (event.jobId !== jobId) {
			throw new BadRequestException(
				'jobId in path does not match jobId in body'
			);
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
