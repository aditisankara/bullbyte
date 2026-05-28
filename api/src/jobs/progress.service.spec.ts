/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment -- the chainable Drizzle query-builder mock below is intentionally loosely typed */
import type { MessageEvent } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { ProgressEvent, SseEventName } from './dto/progress-event.dto';

// Minimal chainable Drizzle mock. terminalSnapshot issues a single
// select().from().where().limit(1); the terminal limit() is programmed per test.
function createDbMock() {
	const selectLimit = jest.fn();
	const selectChain: any = {
		from: () => selectChain,
		where: () => selectChain,
		limit: (...a: unknown[]) => selectLimit(...a),
	};
	const db: any = { select: jest.fn(() => selectChain) };
	return { db, selectLimit };
}

// stream() reads the terminal snapshot asynchronously before attaching to the
// live subject, so let all microtasks settle before publishing.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEvent(jobId: string, event: SseEventName): ProgressEvent {
	return {
		event,
		jobId,
		stepIndex: 1,
		totalSteps: 5,
		message: event,
		timestamp: '2026-05-28T00:00:00.000Z',
	};
}

describe('ProgressService', () => {
	let service: ProgressService;
	let db: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		db = createDbMock();
		service = new ProgressService(db.db);
	});

	it('fans a published event out to every subscriber on the same job (AC5)', async () => {
		db.selectLimit.mockResolvedValue([{ status: 'RUNNING' }]); // not terminal -> live path
		const stream$ = service.stream('job-1');
		const a: MessageEvent[] = [];
		const b: MessageEvent[] = [];
		stream$.subscribe((m) => a.push(m));
		stream$.subscribe((m) => b.push(m));
		await flush();

		service.publish(makeEvent('job-1', 'claims-extracted'));

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		expect(a[0].type).toBe('claims-extracted');
		expect(a[0].data).toEqual(
			expect.objectContaining({
				event: 'claims-extracted',
				jobId: 'job-1',
			})
		);
		expect(b[0].data).toEqual(a[0].data);
	});

	it('delivers the terminal event then completes the stream (AC3)', async () => {
		db.selectLimit.mockResolvedValue([{ status: 'RUNNING' }]);
		const stream$ = service.stream('job-1');
		const received: MessageEvent[] = [];
		let completed = false;
		stream$.subscribe({
			next: (m) => received.push(m),
			complete: () => {
				completed = true;
			},
		});
		await flush();

		service.publish(makeEvent('job-1', 'claims-extracted'));
		service.publish(makeEvent('job-1', 'analysis-complete'));

		expect(received.map((m) => m.type)).toEqual([
			'claims-extracted',
			'analysis-complete',
		]);
		expect(completed).toBe(true);
	});

	it('stops delivering after the terminal event (AC3)', async () => {
		db.selectLimit.mockResolvedValue([{ status: 'RUNNING' }]);
		const stream$ = service.stream('job-1');
		const received: MessageEvent[] = [];
		stream$.subscribe((m) => received.push(m));
		await flush();

		service.publish(makeEvent('job-1', 'analysis-complete'));
		service.publish(makeEvent('job-1', 'claims-extracted')); // after terminal: dropped

		expect(received.map((m) => m.type)).toEqual(['analysis-complete']);
	});

	it('emits the terminal event once and completes for an already-COMPLETED job (AC4)', async () => {
		db.selectLimit.mockResolvedValue([{ status: 'COMPLETED' }]);
		const received: MessageEvent[] = [];
		let completed = false;
		service.stream('job-done').subscribe({
			next: (m) => received.push(m),
			complete: () => {
				completed = true;
			},
		});
		await flush();

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe('analysis-complete');
		expect((received[0].data as ProgressEvent).event).toBe(
			'analysis-complete'
		);
		expect(completed).toBe(true);
	});

	it('emits analysis-failed for an already-FAILED job (AC4)', async () => {
		db.selectLimit.mockResolvedValue([{ status: 'FAILED' }]);
		const received: MessageEvent[] = [];
		service.stream('job-x').subscribe((m) => received.push(m));
		await flush();

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe('analysis-failed');
	});

	it('publish for a job with no active stream is a no-op', () => {
		expect(() =>
			service.publish(makeEvent('ghost', 'analysis-started'))
		).not.toThrow();
	});
});
