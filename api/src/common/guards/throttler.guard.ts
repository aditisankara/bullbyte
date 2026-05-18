import {
	ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
	protected throwThrottlingException(
		_context: ExecutionContext
	): Promise<void> {
		return Promise.reject(
			new HttpException(
				{
					statusCode: HttpStatus.TOO_MANY_REQUESTS,
					error: 'TOO_MANY_REQUESTS',
					code: 'RATE_LIMIT_EXCEEDED',
					details: {},
				},
				HttpStatus.TOO_MANY_REQUESTS
			)
		);
	}
}
