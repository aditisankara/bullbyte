/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- the chainable Drizzle query-builder/transaction mock below is intentionally loosely typed */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VerdictsWriteService } from './verdicts-write.service';

// Thenable chainable mock for the transaction client. write() issues two
// selects in order (claim FOR UPDATE, then latest verdict) followed by a
// single insert().values().returning().
function createDbMock() {
	const selectResults: unknown[][] = [];
	const chain: any = {};
	for (const m of ['from', 'where', 'orderBy', 'limit', 'for']) {
		chain[m] = jest.fn(() => chain);
	}
	chain.then = (resolve: any, reject: any) =>
		Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);

	const returning = jest.fn();
	const values = jest.fn(() => ({ returning }));
	const tx: any = {
		select: jest.fn(() => chain),
		insert: jest.fn(() => ({ values })),
		// update/delete intentionally absent: the verdicts table is append-only
		// at the API layer (AC2) — any UPDATE/DELETE call would throw here.
	};
	const db: any = { transaction: jest.fn((fn: any) => fn(tx)) };
	return {
		db,
		tx,
		chain,
		values,
		returning,
		queueSelect: (rows: unknown[]) => selectResults.push(rows),
	};
}

const INSERTED = { id: 'verdict-new', claimId: 'claim-1' };

describe('VerdictsWriteService', () => {
	let service: VerdictsWriteService;
	let db: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		db = createDbMock();
		db.returning.mockResolvedValue([INSERTED]);
		service = new VerdictsWriteService(db.db);
	});

	it('inserts a non-correction verdict when the claim has none (AC3)', async () => {
		db.queueSelect([{ id: 'claim-1' }]); // claim exists
		db.queueSelect([]); // no prior verdict

		const result = await service.write({
			claimId: 'claim-1',
			verdictType: 'DELIVERED',
			delta: '+4.2%',
			confidenceScore: '0.900',
		});

		expect(result).toBe(INSERTED);
		expect(db.values).toHaveBeenCalledWith({
			claimId: 'claim-1',
			verdictType: 'DELIVERED',
			delta: '+4.2%',
			confidenceScore: '0.900',
			isCorrection: false,
			correctsVerdictId: null,
		});
	});

	it('writes a correction pointing at the latest verdict when one exists (AC2)', async () => {
		db.queueSelect([{ id: 'claim-1' }]);
		db.queueSelect([{ id: 'verdict-original' }]);

		await service.write({ claimId: 'claim-1', verdictType: 'MISSED' });

		expect(db.values).toHaveBeenCalledWith({
			claimId: 'claim-1',
			verdictType: 'MISSED',
			delta: null,
			confidenceScore: null,
			isCorrection: true,
			correctsVerdictId: 'verdict-original',
		});
	});

	it('never mutates existing rows — insert-only inside a claim-locked transaction (AC2, NFR11)', async () => {
		db.queueSelect([{ id: 'claim-1' }]);
		db.queueSelect([{ id: 'verdict-original' }]);

		await service.write({ claimId: 'claim-1', verdictType: 'DELIVERED' });

		expect(db.db.transaction).toHaveBeenCalledTimes(1);
		expect(db.chain.for).toHaveBeenCalledWith('update'); // claim row lock
		expect(db.tx.insert).toHaveBeenCalledTimes(1);
		expect(db.tx.update).toBeUndefined();
		expect(db.tx.delete).toBeUndefined();
	});

	it('throws a CLAIM_NOT_FOUND NotFoundException for an unknown claim', async () => {
		db.queueSelect([]); // claim absent

		expect.assertions(3);
		try {
			await service.write({ claimId: 'nope', verdictType: 'DELIVERED' });
		} catch (err) {
			expect(err).toBeInstanceOf(NotFoundException);
			expect((err as NotFoundException).getResponse()).toEqual({
				code: 'CLAIM_NOT_FOUND',
				details: { claimId: 'nope' },
			});
		}
		expect(db.tx.insert).not.toHaveBeenCalled();
	});

	it('rejects a stale correction with a 409 when the expected target is no longer latest (AC3)', async () => {
		db.queueSelect([{ id: 'claim-1' }]);
		db.queueSelect([{ id: 'verdict-newer' }]); // someone corrected first

		expect.assertions(3);
		try {
			await service.write({
				claimId: 'claim-1',
				verdictType: 'MISSED',
				expectedCorrectsVerdictId: 'verdict-original',
			});
		} catch (err) {
			expect(err).toBeInstanceOf(ConflictException);
			expect((err as ConflictException).getResponse()).toEqual({
				code: 'STALE_VERDICT_CORRECTION',
				details: {
					claimId: 'claim-1',
					expectedCorrectsVerdictId: 'verdict-original',
					latestVerdictId: 'verdict-newer',
				},
			});
		}
		expect(db.tx.insert).not.toHaveBeenCalled();
	});

	it('accepts a correction whose expected target is still the latest verdict', async () => {
		db.queueSelect([{ id: 'claim-1' }]);
		db.queueSelect([{ id: 'verdict-original' }]);

		await service.write({
			claimId: 'claim-1',
			verdictType: 'MISSED',
			expectedCorrectsVerdictId: 'verdict-original',
		});

		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				isCorrection: true,
				correctsVerdictId: 'verdict-original',
			})
		);
	});
});
