import { Inject, Injectable, MessageEvent } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Observable, Subject, defer, from, of } from 'rxjs';
import { map, mergeMap, takeWhile } from 'rxjs/operators';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { analysisJobs } from '../db/schema';
import {
	ProgressEvent,
	SseEventName,
	TERMINAL_EVENTS,
} from './dto/progress-event.dto';

@Injectable()
export class ProgressService {
	// One multicast Subject per active job; all SSE clients for a jobId share it (AC5).
	private readonly streams = new Map<string, Subject<ProgressEvent>>();

	constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

	/**
	 * Push one agent-step event to the active stream for a job. Called by the
	 * FastAPI -> NestJS webhook relay (story 5.3). No active listener is fine —
	 * the webhook is accepted regardless of whether a client is connected.
	 */
	publish(event: ProgressEvent): void {
		const subject = this.streams.get(event.jobId);
		if (!subject) return;
		subject.next(event);
		if (TERMINAL_EVENTS.includes(event.event)) {
			subject.complete(); // AC3: terminal event closes all connections
			this.streams.delete(event.jobId);
		}
	}

	/**
	 * SSE source for a job. If already terminal in the DB, emit the terminal event
	 * once and close (AC4); otherwise stream live events until a terminal one (AC3).
	 */
	stream(jobId: string): Observable<MessageEvent> {
		const live$ = this.subjectFor(jobId)
			.asObservable()
			.pipe(takeWhile((e) => !TERMINAL_EVENTS.includes(e.event), true));

		return defer(() => from(this.terminalSnapshot(jobId))).pipe(
			mergeMap((snapshot) => (snapshot ? of(snapshot) : live$)),
			map((event) => this.toMessage(event))
		);
	}

	private subjectFor(jobId: string): Subject<ProgressEvent> {
		let subject = this.streams.get(jobId);
		if (!subject) {
			subject = new Subject<ProgressEvent>();
			this.streams.set(jobId, subject);
		}
		return subject;
	}

	private async terminalSnapshot(jobId: string): Promise<ProgressEvent | null> {
		const [job] = await this.db
			.select({ status: analysisJobs.status })
			.from(analysisJobs)
			.where(eq(analysisJobs.id, jobId))
			.limit(1);
		if (job?.status === 'COMPLETED') {
			return this.event(jobId, 'analysis-complete', 'Analysis complete');
		}
		if (job?.status === 'FAILED') {
			return this.event(jobId, 'analysis-failed', 'Analysis failed');
		}
		return null;
	}

	private event(
		jobId: string,
		name: SseEventName,
		message: string
	): ProgressEvent {
		return {
			event: name,
			jobId,
			stepIndex: 0,
			totalSteps: 0,
			message,
			timestamp: new Date().toISOString(),
		};
	}

	private toMessage(event: ProgressEvent): MessageEvent {
		return { data: event, type: event.event };
	}
}
