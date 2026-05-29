import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalWebhookGuard } from './internal-webhook.guard';

const SECRET = 'super-secret-token';

function contextWithHeaders(
	headers: Record<string, unknown>
): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({ headers }),
		}),
	} as unknown as ExecutionContext;
}

describe('InternalWebhookGuard', () => {
	let guard: InternalWebhookGuard;

	beforeEach(() => {
		const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
		guard = new InternalWebhookGuard(config as any);
	});

	it('allows a request carrying the correct token', () => {
		expect(
			guard.canActivate(
				contextWithHeaders({ 'x-internal-token': SECRET })
			)
		).toBe(true);
	});

	it('rejects a request with a wrong token', () => {
		expect(() =>
			guard.canActivate(
				contextWithHeaders({ 'x-internal-token': 'nope' })
			)
		).toThrow(UnauthorizedException);
	});

	it('rejects a request with no token header', () => {
		expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(
			UnauthorizedException
		);
	});
});
