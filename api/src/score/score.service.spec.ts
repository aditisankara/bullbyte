/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- the chainable Drizzle query-builder mock below is intentionally loosely typed */
import { NotFoundException } from '@nestjs/common';
import { ScoreService } from './score.service';

// Thenable chainable Drizzle mock. getScore issues three selects in order
// (company, claims, verdicts); each await resolves the next queued result,
// regardless of which builder method the query terminates on.
function createDbMock() {
	const results: unknown[][] = [];
	const chain: any = {};
	for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) {
		chain[m] = jest.fn(() => chain);
	}
	chain.then = (resolve: any, reject: any) =>
		Promise.resolve(results.shift() ?? []).then(resolve, reject);
	const db: any = { select: jest.fn(() => chain) };
	return { db, queueResult: (rows: unknown[]) => results.push(rows) };
}

const COMPANY = [{ id: 'company-1' }];

describe('ScoreService', () => {
	let service: ScoreService;
	let db: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		db = createDbMock();
		service = new ScoreService(db.db);
	});

	it('computes score and counts from mixed effective verdicts (AC1)', async () => {
		db.queueResult(COMPANY);
		db.queueResult([
			{ id: 'c1' },
			{ id: 'c2' },
			{ id: 'c3' },
			{ id: 'c4' },
			{ id: 'c5' },
		]);
		db.queueResult([
			{ claimId: 'c1', verdictType: 'DELIVERED' },
			{ claimId: 'c2', verdictType: 'DELIVERED' },
			{ claimId: 'c3', verdictType: 'MISSED' },
			{ claimId: 'c4', verdictType: 'INSUFFICIENT_DATA' },
			{ claimId: 'c5', verdictType: 'PENDING' },
		]);

		const result = await service.getScore('TSLA');

		expect(result).toEqual({
			ticker: 'TSLA',
			score: 2 / 3,
			deliveredCount: 2,
			missedCount: 1,
			totalResolved: 3,
			pendingCount: 1,
			insufficientDataCount: 1,
			context:
				'2 of 3 resolved promises delivered — 1 pending — 1 insufficient data',
		});
	});

	it('counts a corrected claim once, by its correction (AC1)', async () => {
		db.queueResult(COMPANY);
		db.queueResult([{ id: 'c1' }, { id: 'c2' }]);
		// Rows arrive newest-first: c1's correction (DELIVERED) precedes its
		// superseded original (MISSED). c1 must count as DELIVERED, once.
		db.queueResult([
			{ claimId: 'c1', verdictType: 'DELIVERED' },
			{ claimId: 'c2', verdictType: 'MISSED' },
			{ claimId: 'c1', verdictType: 'MISSED' },
		]);

		const result = await service.getScore('TSLA');

		expect(result.deliveredCount).toBe(1);
		expect(result.missedCount).toBe(1);
		expect(result.totalResolved).toBe(2);
		expect(result.score).toBe(0.5);
	});

	it('counts a claim with no verdict row as pending (AC4)', async () => {
		db.queueResult(COMPANY);
		db.queueResult([{ id: 'c1' }, { id: 'c2' }]);
		db.queueResult([{ claimId: 'c1', verdictType: 'DELIVERED' }]); // c2 has no row

		const result = await service.getScore('TSLA');

		expect(result.pendingCount).toBe(1);
		expect(result.totalResolved).toBe(1);
		expect(result.score).toBe(1);
	});

	it('returns null score — never 0 — with context when nothing is resolved (AC1)', async () => {
		db.queueResult(COMPANY);
		db.queueResult([{ id: 'c1' }, { id: 'c2' }]);
		db.queueResult([{ claimId: 'c1', verdictType: 'PENDING' }]);

		const result = await service.getScore('TSLA');

		expect(result.score).toBeNull();
		expect(result.context).toBe('No resolved claims yet');
		expect(result.pendingCount).toBe(2);
		expect(result.totalResolved).toBe(0);
	});

	it('returns a 200-shaped null-score payload for a known ticker with zero claims', async () => {
		db.queueResult(COMPANY);
		db.queueResult([]);
		db.queueResult([]);

		const result = await service.getScore('TSLA');

		expect(result).toEqual({
			ticker: 'TSLA',
			score: null,
			deliveredCount: 0,
			missedCount: 0,
			totalResolved: 0,
			pendingCount: 0,
			insufficientDataCount: 0,
			context: 'No resolved claims yet',
		});
	});

	it('silently excludes claims whose effective verdict is REVISED (4.6 parity)', async () => {
		db.queueResult(COMPANY);
		db.queueResult([{ id: 'c1' }, { id: 'c2' }]);
		db.queueResult([
			{ claimId: 'c1', verdictType: 'REVISED' },
			{ claimId: 'c2', verdictType: 'DELIVERED' },
		]);

		const result = await service.getScore('TSLA');

		expect(result.deliveredCount).toBe(1);
		expect(result.pendingCount).toBe(0);
		expect(result.insufficientDataCount).toBe(0);
		expect(result.totalResolved).toBe(1);
	});

	it('throws a TICKER_NOT_FOUND NotFoundException when the ticker is absent', async () => {
		db.queueResult([]); // company not found

		expect.assertions(2);
		try {
			await service.getScore('XYZ');
		} catch (err) {
			expect(err).toBeInstanceOf(NotFoundException);
			expect((err as NotFoundException).getResponse()).toEqual({
				code: 'TICKER_NOT_FOUND',
				details: { ticker: 'XYZ' },
			});
		}
	});
});
