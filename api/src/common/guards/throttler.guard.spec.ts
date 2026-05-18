import { CustomThrottlerGuard } from './throttler.guard';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('CustomThrottlerGuard', () => {
	it('throwThrottlingException throws HttpException with 429 standard shape', async () => {
		const guard = new CustomThrottlerGuard({} as any, {} as any, {} as any);
		await expect(
			guard['throwThrottlingException'](null as any)
		).rejects.toMatchObject({
			response: {
				statusCode: HttpStatus.TOO_MANY_REQUESTS,
				error: 'TOO_MANY_REQUESTS',
				code: 'RATE_LIMIT_EXCEEDED',
				details: {},
			},
		});
	});

	it('throwThrottlingException throws an HttpException', async () => {
		const guard = new CustomThrottlerGuard({} as any, {} as any, {} as any);
		let thrown: unknown;
		try {
			await guard['throwThrottlingException'](null as any);
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(429);
	});
});
