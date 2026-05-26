/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- the chainable Drizzle query-builder mock below is intentionally loosely typed */
import { JobsService, ANALYSIS_QUEUE } from './jobs.service';

// Minimal chainable Drizzle mock. Terminal methods (select->limit,
// insert->returning, update->where) are jest.fns programmed per test in call order.
function createDbMock() {
	const selectLimit = jest.fn();
	const insertReturning = jest.fn();
	const insertValues = jest.fn();
	const updateSet = jest.fn();
	const updateWhere = jest.fn().mockResolvedValue(undefined);

	const selectChain: any = {
		from: () => selectChain,
		where: () => selectChain,
		orderBy: () => selectChain,
		limit: (...a: unknown[]) => selectLimit(...a),
	};

	const insertChain: any = {
		onConflictDoNothing: () => insertChain,
		returning: (...a: unknown[]) => insertReturning(...a),
	};
	insertValues.mockReturnValue(insertChain);
	insertChain.values = insertValues;

	const updateChain: any = {
		where: (...a: unknown[]) => updateWhere(...a),
	};
	updateSet.mockReturnValue(updateChain);
	updateChain.set = updateSet;

	const db: any = {
		select: jest.fn(() => selectChain),
		insert: jest.fn(() => insertChain),
		update: jest.fn(() => updateChain),
	};

	return { db, selectLimit, insertReturning, insertValues, updateSet };
}

describe('JobsService', () => {
	let service: JobsService;
	let db: ReturnType<typeof createDbMock>;
	let queue: { add: jest.Mock };

	beforeEach(() => {
		db = createDbMock();
		queue = { add: jest.fn().mockResolvedValue(undefined) };
		service = new JobsService(db.db, queue as any);
	});

	it('enqueues a QUEUED job for an uncached, existing ticker (AC1)', async () => {
		db.selectLimit
			.mockResolvedValueOnce([{ id: 'company-1' }]) // ensureCompany: exists
			.mockResolvedValueOnce([]); // isCached: no prior job
		db.insertReturning.mockResolvedValueOnce([{ id: 'job-1' }]); // job row

		const result = await service.requestAnalysis('TSLA');

		expect(result).toEqual({ jobId: 'job-1', status: 'QUEUED' });
		expect(queue.add).toHaveBeenCalledWith(ANALYSIS_QUEUE, {
			jobId: 'job-1',
			ticker: 'TSLA',
		});
		expect(db.insertValues).toHaveBeenCalledWith({
			companyId: 'company-1',
			status: 'QUEUED',
		});
	});

	it('returns COMPLETED/cached and enqueues nothing for a cached ticker (AC3)', async () => {
		db.selectLimit
			.mockResolvedValueOnce([{ id: 'company-1' }]) // ensureCompany: exists
			.mockResolvedValueOnce([{ status: 'COMPLETED' }]); // isCached: latest done

		const result = await service.requestAnalysis('TSLA');

		expect(result).toEqual({
			jobId: null,
			status: 'COMPLETED',
			cached: true,
		});
		expect(queue.add).not.toHaveBeenCalled();
	});

	it('creates the company when missing, then enqueues', async () => {
		db.selectLimit
			.mockResolvedValueOnce([]) // ensureCompany: not found
			.mockResolvedValueOnce([]); // isCached: no prior job
		db.insertReturning
			.mockResolvedValueOnce([{ id: 'company-2' }]) // company insert
			.mockResolvedValueOnce([{ id: 'job-2' }]); // job insert

		const result = await service.requestAnalysis('SPOT');

		expect(db.insertValues).toHaveBeenCalledWith({
			ticker: 'SPOT',
			name: 'SPOT',
		});
		expect(result).toEqual({ jobId: 'job-2', status: 'QUEUED' });
	});

	it('markRunning writes the RUNNING enum value (AC2, AC5)', async () => {
		await service.markRunning('job-1');
		expect(db.updateSet).toHaveBeenCalledWith({ status: 'RUNNING' });
	});

	it('markFailed writes the FAILED enum value (AC4, AC5)', async () => {
		await service.markFailed('job-1');
		expect(db.updateSet).toHaveBeenCalledWith({ status: 'FAILED' });
	});
});
