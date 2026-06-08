/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment -- the chainable Drizzle query-builder mock below is intentionally loosely typed */
import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';

// Minimal chainable Drizzle mock. getSummary issues two selects in order
// (company, then latest job); the terminal limit() is programmed per test.
function createDbMock() {
	const selectLimit = jest.fn();
	const selectChain: any = {
		from: () => selectChain,
		where: () => selectChain,
		orderBy: () => selectChain,
		limit: (...a: unknown[]) => selectLimit(...a),
	};
	const db: any = { select: jest.fn(() => selectChain) };
	return { db, selectLimit };
}

describe('CompaniesService', () => {
	let service: CompaniesService;
	let db: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		db = createDbMock();
		service = new CompaniesService(db.db);
	});

	it('returns the camelCase summary with the latest jobStatus (AC1)', async () => {
		const analysedAt = new Date('2026-05-01T12:00:00.000Z');
		db.selectLimit
			.mockResolvedValueOnce([
				{
					id: 'company-1',
					ticker: 'TSLA',
					name: 'Tesla, Inc.',
					lastAnalysedAt: analysedAt,
				},
			])
			.mockResolvedValueOnce([{ id: 'job-1', status: 'COMPLETED' }]);

		const result = await service.getSummary('TSLA');

		expect(result).toEqual({
			id: 'company-1',
			ticker: 'TSLA',
			name: 'Tesla, Inc.',
			lastAnalysedAt: '2026-05-01T12:00:00.000Z',
			jobStatus: 'COMPLETED',
			latestJobId: 'job-1',
		});
	});

	it('returns null lastAnalysedAt and null jobStatus when never analysed', async () => {
		db.selectLimit
			.mockResolvedValueOnce([
				{
					id: 'company-2',
					ticker: 'SPOT',
					name: 'Spotify',
					lastAnalysedAt: null,
				},
			])
			.mockResolvedValueOnce([]); // no analysis jobs yet

		const result = await service.getSummary('SPOT');

		expect(result.lastAnalysedAt).toBeNull();
		expect(result.jobStatus).toBeNull();
		expect(result.latestJobId).toBeNull();
	});

	it('throws a TICKER_NOT_FOUND NotFoundException when the ticker is absent (AC2)', async () => {
		db.selectLimit.mockResolvedValueOnce([]); // company not found

		expect.assertions(2);
		try {
			await service.getSummary('XYZ');
		} catch (err) {
			expect(err).toBeInstanceOf(NotFoundException);
			expect((err as NotFoundException).getResponse()).toEqual({
				code: 'TICKER_NOT_FOUND',
				details: { ticker: 'XYZ' },
			});
		}
	});
});
