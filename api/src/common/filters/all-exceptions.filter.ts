import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

function httpStatusToError(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return map[status] ?? 'UNKNOWN_ERROR';
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response.headersSent) {
      this.logger.error(
        'Response already sent when exception caught',
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const errorCode = httpStatusToError(status);
      const code =
        typeof res === 'object' && res !== null && 'code' in res
          ? (res as Record<string, unknown>).code
          : errorCode;
      const details =
        typeof res === 'object' && res !== null && 'details' in res
          ? (res as Record<string, unknown>).details
          : {};

      response.status(status).json({
        statusCode: status,
        error: errorCode,
        code,
        details: details ?? {},
      });
    } else {
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
      response.status(500).json({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR',
        code: 'INTERNAL_SERVER_ERROR',
        details: {},
      });
    }
  }
}
