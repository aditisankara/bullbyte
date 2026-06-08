/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- the chainable Drizzle query-builder mock below is intentionally loosely typed */
import { NotFoundException } from '@nestjs/common';
import { ClaimsService } from './claims.service';

// Thenable chain mock: every db.select() pops the next queued result; all
// builder methods are chainable no-ops, and awaiting the chain resolves the
// queued rows. Queue order == select() call order (each query is awaited
// before the service issues the next one).
function createDbMock() {
	const queue: unknown[][] = [];
	function chain(result: unknown[]): any {
		const c: any = {};
		for (const m of [
			'from',
			'where',
			'limit',
			'offset',
			'orderBy',
			'groupBy',
			'innerJoin',
		]) {
			c[m] = jest.fn(() => c);
		}
		c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
		return c;
	}
	const db: any = { select: jest.fn(() => chain(queue.shift() ?? [])) };
	return { db, queue };
}

const T0 = new Date('2026-06-01T00:00:00.000Z');
const T1 = new Date('2026-06-02T00:00:00.000Z');

function claimRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'claim-1',
		companyId: 'company-1',
		quarter: 'Q3-2024',
		rawQuote: 'We expect revenue of $120 billion next quarter.',
		metric: 'Q4 revenue',
		targetValue: '120',
		targetUnit: 'billion USD',
		extractionConfidence: '0.850',
		speaker: 'Jane Doe, CEO',
		createdAt: T0,
		...overrides,
	};
}

function verdictRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'verdict-1',
		claimId: 'claim-1',
		verdictType: 'DELIVERED',
		delta: '+4.2%',
		confidenceScore: '0.910',
		isCorrection: false,
		correctsVerdictId: null,
		createdAt: T0,
		...overrides,
	};
}

describe('ClaimsService', () => {
	let service: ClaimsService;
	let mock: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		mock = createDbMock();
		service = new ClaimsService(mock.db);
	});

	describe('listByTicker', () => {
		it('returns the paginated envelope with nested verdicts (AC1)', async () => {
			mock.queue.push(
				[{ id: 'company-1' }], // company lookup
				[{ quarter: 'Q3-2024' }], // quarter window
				[{ total: 1 }], // count
				[claimRow()], // page rows
				[verdictRow()] // verdicts
			);

			const result = await service.listByTicker('TSLA', 1);

			expect(result).toEqual({
				data: [
					{
						id: 'claim-1',
						quarter: 'Q3-2024',
						rawQuote:
							'We expect revenue of $120 billion next quarter.',
						speaker: 'Jane Doe, CEO',
						metric: 'Q4 revenue',
						targetValue: '120',
						targetUnit: 'billion USD',
						extractionConfidence: 0.85,
						verdict: {
							id: 'verdict-1',
							verdictType: 'DELIVERED',
							delta: '+4.2%',
							confidenceScore: 0.91,
							isCorrection: false,
							createdAt: T0.toISOString(),
						},
					},
				],
				meta: { total: 1, page: 1, pageSize: 20 },
			});
			expect(result.data[0].quarter).toMatch(/^Q[1-4]-\d{4}$/);
		});

		it('exposes a PENDING verdict as null (AC1)', async () => {
			mock.queue.push(
				[{ id: 'company-1' }],
				[{ quarter: 'Q3-2024' }],
				[{ total: 1 }],
				[claimRow()],
				[verdictRow({ verdictType: 'PENDING', delta: null })]
			);

			const result = await service.listByTicker('TSLA', 1);

			expect(result.data[0].verdict).toBeNull();
		});

		it('picks the correction even when created_at ties (same-transaction writes)', async () => {
			mock.queue.push(
				[{ id: 'company-1' }],
				[{ quarter: 'Q3-2024' }],
				[{ total: 1 }],
				[claimRow()],
				[
					// Identical createdAt (Postgres now() is transaction time) and
					// the DB happened to return the superseded original first.
					verdictRow({ verdictType: 'PENDING', delta: null }),
					verdictRow({
						id: 'verdict-2',
						verdictType: 'DELIVERED',
						isCorrection: true,
						correctsVerdictId: 'verdict-1',
					}),
				]
			);

			const result = await service.listByTicker('TSLA', 1);

			expect(result.data[0].verdict).toMatchObject({
				id: 'verdict-2',
				verdictType: 'DELIVERED',
			});
		});

		it('uses the newest verdicts row per claim — corrections win', async () => {
			mock.queue.push(
				[{ id: 'company-1' }],
				[{ quarter: 'Q3-2024' }],
				[{ total: 1 }],
				[claimRow()],
				[
					// latestVerdictsFor orders desc(createdAt): newest first
					verdictRow({
						id: 'verdict-2',
						verdictType: 'MISSED',
						isCorrection: true,
						correctsVerdictId: 'verdict-1',
						createdAt: T1,
					}),
					verdictRow(),
				]
			);

			const result = await service.listByTicker('TSLA', 1);

			expect(result.data[0].verdict).toMatchObject({
				id: 'verdict-2',
				verdictType: 'MISSED',
				isCorrection: true,
			});
		});

		it('returns an empty 200 envelope when the ticker has no claims (AC4)', async () => {
			mock.queue.push(
				[{ id: 'company-1' }],
				[] // no quarters → no claims yet
			);

			const result = await service.listByTicker('TSLA', 1);

			expect(result).toEqual({
				data: [],
				meta: { total: 0, page: 1, pageSize: 20 },
			});
			// Short-circuits: no count/page/verdict queries are issued.
			expect(mock.db.select).toHaveBeenCalledTimes(2);
		});

		it('throws TICKER_NOT_FOUND for an unknown ticker', async () => {
			mock.queue.push([]); // no company row

			expect.assertions(2);
			try {
				await service.listByTicker('XYZ', 1);
			} catch (err) {
				expect(err).toBeInstanceOf(NotFoundException);
				expect((err as NotFoundException).getResponse()).toEqual({
					code: 'TICKER_NOT_FOUND',
					details: { ticker: 'XYZ' },
				});
			}
		});

		it('clamps page to 1 and reports the requested page in meta', async () => {
			mock.queue.push(
				[{ id: 'company-1' }],
				[{ quarter: 'Q3-2024' }],
				[{ total: 45 }],
				[] // page beyond the data → empty rows
				// no verdicts query: claimIds is empty
			);

			const result = await service.listByTicker('TSLA', 3);

			expect(result.meta).toEqual({ total: 45, page: 3, pageSize: 20 });
			expect(result.data).toEqual([]);
			expect(mock.db.select).toHaveBeenCalledTimes(4);
		});
	});

	describe('getDetail', () => {
		it('returns the full detail with ordered trace and EDGAR source (AC2)', async () => {
			const trace = [
				{
					stepIndex: 0,
					toolCall: { tool: 'fetch_actuals', quarter: 'Q4-2024' },
					resultSummary: 'Fetched 10-Q actuals',
					edgarFilingRef: 'acc-001',
				},
				{
					stepIndex: 1,
					toolCall: { tool: 'compare' },
					resultSummary: 'Revenue beat target by 4.2%',
					edgarFilingRef: null,
				},
			];
			mock.queue.push(
				[{ claim: claimRow(), ticker: 'TSLA' }], // claim + company join
				[verdictRow()], // latest verdict
				trace.map((t) => ({
					id: 't',
					verdictId: 'verdict-1',
					createdAt: T0,
					...t,
				})),
				[
					{
						filingUrl:
							'https://www.sec.gov/Archives/edgar/data/x/8k.htm',
					},
				]
			);

			const result = await service.getDetail('claim-1');

			expect(result).toMatchObject({
				id: 'claim-1',
				quarter: 'Q3-2024',
				rawQuote: 'We expect revenue of $120 billion next quarter.',
				speaker: 'Jane Doe, CEO',
				targetUnit: 'billion USD',
				verdict: {
					verdictType: 'DELIVERED',
					delta: '+4.2%',
					confidenceScore: 0.91,
					isCorrection: false,
				},
				edgarSourceUrl:
					'https://www.sec.gov/Archives/edgar/data/x/8k.htm',
				lowConfidence: false,
			});
			expect(result.reasoningTrace).toEqual(trace);
		});

		it('flags lowConfidence below the 0.6 threshold, verdict still returned (AC3)', async () => {
			mock.queue.push(
				[{ claim: claimRow(), ticker: 'TSLA' }],
				[verdictRow({ confidenceScore: '0.550' })],
				[], // no trace rows
				[] // no cached transcript
			);

			const result = await service.getDetail('claim-1');

			expect(result.lowConfidence).toBe(true);
			expect(result.verdict).not.toBeNull(); // never withheld
			expect(result.edgarSourceUrl).toBeNull();
		});

		it('does not flag lowConfidence at exactly the threshold', async () => {
			mock.queue.push(
				[{ claim: claimRow(), ticker: 'TSLA' }],
				[verdictRow({ confidenceScore: '0.600' })],
				[],
				[]
			);

			const result = await service.getDetail('claim-1');

			expect(result.lowConfidence).toBe(false);
		});

		it('serves a pending claim with verdict null but the trace so far', async () => {
			mock.queue.push(
				[{ claim: claimRow(), ticker: 'TSLA' }],
				[verdictRow({ verdictType: 'PENDING', confidenceScore: null })],
				[
					{
						id: 't1',
						verdictId: 'verdict-1',
						stepIndex: 0,
						toolCall: null,
						resultSummary: 'Awaiting Q4-2024 actuals',
						edgarFilingRef: null,
						createdAt: T0,
					},
				],
				[]
			);

			const result = await service.getDetail('claim-1');

			expect(result.verdict).toBeNull();
			expect(result.lowConfidence).toBe(false);
			expect(result.reasoningTrace).toHaveLength(1);
		});

		it('throws CLAIM_NOT_FOUND when the claim is absent', async () => {
			mock.queue.push([]); // no claim row

			expect.assertions(2);
			try {
				await service.getDetail('00000000-0000-0000-0000-000000000000');
			} catch (err) {
				expect(err).toBeInstanceOf(NotFoundException);
				expect((err as NotFoundException).getResponse()).toEqual({
					code: 'CLAIM_NOT_FOUND',
					details: {
						claimId: '00000000-0000-0000-0000-000000000000',
					},
				});
			}
		});
	});
});
