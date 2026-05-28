import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const TICKER_PATTERN = /^[A-Z.]{1,10}$/;

/**
 * Normalises a ticker path param to uppercase and validates its shape.
 * Shared by the jobs and companies controllers.
 */
@Injectable()
export class TickerValidationPipe implements PipeTransform<string, string> {
	transform(value: string): string {
		const ticker = (value ?? '').trim().toUpperCase();
		if (!TICKER_PATTERN.test(ticker)) {
			throw new BadRequestException({
				code: 'INVALID_TICKER',
				details: { ticker: value },
			});
		}
		return ticker;
	}
}
