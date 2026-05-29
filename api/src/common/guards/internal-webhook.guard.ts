import { timingSafeEqual } from 'crypto';
import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const TOKEN_HEADER = 'x-internal-token';

/**
 * Restricts the `/internal/*` webhook routes to callers that present the shared
 * secret in the `X-Internal-Token` header (story 5.3, NFR13/NFR14).
 *
 * The API's :3000 port is published to the host, so the `/internal` path
 * namespace alone does not make the webhook unreachable from outside the Docker
 * network — the secret does. FastAPI reads the same secret from env and sends it.
 */
@Injectable()
export class InternalWebhookGuard implements CanActivate {
	private readonly secret: string;

	constructor(config: ConfigService) {
		this.secret = config.getOrThrow<string>('INTERNAL_WEBHOOK_SECRET');
	}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const provided = request.headers[TOKEN_HEADER];

		if (typeof provided !== 'string' || !this.matches(provided)) {
			throw new UnauthorizedException('Invalid internal webhook token');
		}
		return true;
	}

	/** Constant-time comparison; length mismatch short-circuits safely. */
	private matches(provided: string): boolean {
		const a = Buffer.from(provided);
		const b = Buffer.from(this.secret);
		return a.length === b.length && timingSafeEqual(a, b);
	}
}
