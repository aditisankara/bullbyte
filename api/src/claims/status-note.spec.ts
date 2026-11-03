import { statusNote } from './claims.service';

describe('statusNote', () => {
	it('explains a pending claim', () => {
		expect(
			statusNote('PENDING', 'Aligned Q3-2026 → Q4-2026 (PENDING, LOW)')
		).toBe('Waiting for the filing that reports this period.');
	});

	it('strips the LLM verdict prefix down to the reason', () => {
		expect(
			statusNote(
				'INSUFFICIENT_DATA',
				'LLM verdict: INSUFFICIENT_DATA (matched: none). The filing has no quarterly opex.'
			)
		).toBe('The filing has no quarterly opex.');
	});

	it('truncates very long reasons and falls back when there is no trace', () => {
		const long = statusNote('INSUFFICIENT_DATA', 'x'.repeat(400));
		expect(long.length).toBeLessThanOrEqual(180);
		expect(long.endsWith('…')).toBe(true);
		expect(statusNote('INSUFFICIENT_DATA', null)).toMatch(/Not enough/);
	});
});
