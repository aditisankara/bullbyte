import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(responseMock: {
	status: jest.Mock;
	json: jest.Mock;
	headersSent?: boolean;
}) {
	return {
		switchToHttp: () => ({
			getResponse: () => responseMock,
		}),
	} as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
	let filter: AllExceptionsFilter;
	let status: jest.Mock;
	let json: jest.Mock;
	let host: ArgumentsHost;

	beforeEach(() => {
		filter = new AllExceptionsFilter();
		json = jest.fn();
		status = jest.fn().mockReturnValue({ json });
		host = makeHost({ status, json });
	});

	it('maps HttpException to correct shape', () => {
		filter.catch(
			new HttpException('Not found', HttpStatus.NOT_FOUND),
			host
		);
		expect(status).toHaveBeenCalledWith(404);
		expect(json).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 404,
				error: 'NOT_FOUND',
				code: 'NOT_FOUND',
				details: {},
			})
		);
	});

	it('maps ThrottlerException (429) to RATE_LIMIT_EXCEEDED when code provided', () => {
		const err = new HttpException(
			{
				statusCode: 429,
				error: 'TOO_MANY_REQUESTS',
				code: 'RATE_LIMIT_EXCEEDED',
				details: {},
			},
			429
		);
		filter.catch(err, host);
		expect(status).toHaveBeenCalledWith(429);
		expect(json).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 429,
				error: 'TOO_MANY_REQUESTS',
				code: 'RATE_LIMIT_EXCEEDED',
			})
		);
	});

	it('returns 500 for generic Error without exposing message', () => {
		filter.catch(new Error('internal details'), host);
		expect(status).toHaveBeenCalledWith(500);
		const [[call]] = json.mock.calls as [[Record<string, unknown>]];
		expect(call.statusCode).toBe(500);
		expect(call.error).toBe('INTERNAL_SERVER_ERROR');
		expect(JSON.stringify(call)).not.toContain('internal details');
		expect(JSON.stringify(call)).not.toContain('stack');
	});

	it('does not expose stack trace in response', () => {
		filter.catch(new Error('secret'), host);
		const [[call]] = json.mock.calls as [[Record<string, unknown>]];
		expect(JSON.stringify(call)).not.toContain('secret');
	});

	it('skips response when headers already sent', () => {
		const alreadySentHost = makeHost({ status, json, headersSent: true });
		filter.catch(new Error('too late'), alreadySentHost);
		expect(status).not.toHaveBeenCalled();
		expect(json).not.toHaveBeenCalled();
	});
});
