import { IsIn, IsInt, IsISO8601, IsString, Min } from 'class-validator';
import { SSE_EVENTS } from './progress-event.dto';
import type { ProgressEvent, SseEventName } from './progress-event.dto';

/**
 * Body of the FastAPI -> NestJS progress webhook (story 5.3).
 *
 * This is the wire-validated form of {@link ProgressEvent} — same fields, same
 * kebab-case event names. The payload is relayed to the SSE stream untouched
 * (AC2: no transformation), so this shape MUST stay identical to the SSE
 * contract in progress-event.dto.ts and the FastAPI Pydantic model.
 */
export class ProgressWebhookDto implements ProgressEvent {
	@IsIn(SSE_EVENTS)
	event!: SseEventName;

	@IsString()
	jobId!: string;

	@IsInt()
	@Min(0)
	stepIndex!: number;

	@IsInt()
	@Min(0)
	totalSteps!: number;

	@IsString()
	message!: string;

	@IsISO8601()
	timestamp!: string;
}
