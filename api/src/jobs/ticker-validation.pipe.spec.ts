import { BadRequestException } from '@nestjs/common';
import { TickerValidationPipe } from './ticker-validation.pipe';

describe('TickerValidationPipe', () => {
	let pipe: TickerValidationPipe;

	beforeEach(() => {
		pipe = new TickerValidationPipe();
	});

	it('uppercases and trims a valid ticker', () => {
		expect(pipe.transform(' tsla ')).toBe('TSLA');
	});

	it('accepts dotted tickers (e.g. BRK.B)', () => {
		expect(pipe.transform('brk.b')).toBe('BRK.B');
	});

	it('rejects a ticker with invalid characters', () => {
		expect(() => pipe.transform('not_a_ticker')).toThrow(
			BadRequestException
		);
	});

	it('rejects an over-long ticker', () => {
		expect(() => pipe.transform('ABCDEFGHIJK')).toThrow(
			BadRequestException
		);
	});

	it('rejects empty input', () => {
		expect(() => pipe.transform('')).toThrow(BadRequestException);
	});
});
