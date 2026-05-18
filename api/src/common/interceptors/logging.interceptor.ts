import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { Request } from 'express';

const CONTROL_CHARS_RE = /[\r\n\x00-\x1f\x7f]/g;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method } = request;
    const path = request.path.replace(CONTROL_CHARS_RE, '');
    this.logger.info({ message: 'request', method, path });
    return next.handle().pipe(
      tap({
        error: (err: unknown) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          this.logger.warn({ message: 'response', method, path, statusCode: status });
        },
      }),
    );
  }
}
