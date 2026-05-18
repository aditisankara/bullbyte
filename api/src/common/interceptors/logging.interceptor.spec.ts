import { LoggingInterceptor } from './logging.interceptor';
import {
	ExecutionContext,
	CallHandler,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('LoggingInterceptor', () => {
	it('calls logger.info with method, path, and message', () => {
		const mockLogger = { info: jest.fn(), warn: jest.fn() } as any;
		const interceptor = new LoggingInterceptor(mockLogger);

		const context = {
			switchToHttp: () => ({
				getRequest: () => ({ method: 'GET', path: '/api/v1/health' }),
			}),
		} as unknown as ExecutionContext;

		const next: CallHandler = { handle: () => of(null) };
		interceptor.intercept(context, next).subscribe();

		expect(mockLogger.info).toHaveBeenCalledWith({
			message: 'request',
			method: 'GET',
			path: '/api/v1/health',
		});
	});

	it('returns the observable from next.handle()', (done) => {
		const mockLogger = { info: jest.fn(), warn: jest.fn() } as any;
		const interceptor = new LoggingInterceptor(mockLogger);

		const context = {
			switchToHttp: () => ({
				getRequest: () => ({ method: 'POST', path: '/api/v1/search' }),
			}),
		} as unknown as ExecutionContext;

		const next: CallHandler = { handle: () => of('response') };
		interceptor.intercept(context, next).subscribe((val) => {
			expect(val).toBe('response');
			done();
		});
	});

	it('strips control characters from path before logging', () => {
		const mockLogger = { info: jest.fn(), warn: jest.fn() } as any;
		const interceptor = new LoggingInterceptor(mockLogger);

		const context = {
			switchToHttp: () => ({
				getRequest: () => ({
					method: 'GET',
					path: '/api/v1/health\r\nX-Injected: evil',
				}),
			}),
		} as unknown as ExecutionContext;

		const next: CallHandler = { handle: () => of(null) };
		interceptor.intercept(context, next).subscribe();

		const logged = mockLogger.info.mock.calls[0][0];
		expect(logged.path).not.toMatch(/[\r\n]/);
		expect(logged.path).toBe('/api/v1/healthX-Injected: evil');
	});

	it('logs warn with statusCode on error response', (done) => {
		const mockLogger = { info: jest.fn(), warn: jest.fn() } as any;
		const interceptor = new LoggingInterceptor(mockLogger);

		const context = {
			switchToHttp: () => ({
				getRequest: () => ({ method: 'GET', path: '/api/v1/missing' }),
			}),
		} as unknown as ExecutionContext;

		const err = new HttpException('Not found', HttpStatus.NOT_FOUND);
		const next: CallHandler = { handle: () => throwError(() => err) };
		interceptor.intercept(context, next).subscribe({
			error: () => {
				expect(mockLogger.warn).toHaveBeenCalledWith(
					expect.objectContaining({
						message: 'response',
						statusCode: 404,
					})
				);
				done();
			},
		});
	});
});
