import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { AdminRequest } from '../../admin-auth/admin-actor';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    // Protect authenticated responses on direct Cloud Run URLs as well as
    // Firebase Hosting, whose separate routing configuration also disables caching.
    if (request.adminActor)
      response.setHeader('Cache-Control', 'private, no-store');

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            event: 'http_request',
            method: request.method,
            path: request.path,
            status: response.statusCode,
            ...(request.adminActor ? { actorId: request.adminActor.id } : {}),
            durationMs: Date.now() - startedAt,
          }),
        );
      }),
    );
  }
}
