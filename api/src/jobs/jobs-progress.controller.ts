import { Controller, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ProgressService } from './progress.service';

@Controller('jobs')
export class JobsProgressController {
	constructor(private readonly progress: ProgressService) {}

	/**
	 * GET /api/v1/jobs/:jobId/progress  (Accept: text/event-stream).
	 * @Sse() sets the text/event-stream + no-cache headers; the stream closes
	 * itself on a terminal event (AC1, AC3).
	 */
	@Sse(':jobId/progress')
	streamProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
		return this.progress.stream(jobId);
	}
}
