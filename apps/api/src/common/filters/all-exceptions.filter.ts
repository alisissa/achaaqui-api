import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

function isHttpErrorResponse(
  value: unknown,
): value is { error?: string; message?: string | string[] } {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const safeResponse = isHttpErrorResponse(responseBody)
      ? responseBody
      : undefined;
    const body: ErrorBody = {
      statusCode: status,
      error:
        safeResponse?.error ??
        (status === 500 ? 'Internal Server Error' : 'Request Error'),
      message:
        safeResponse?.message ??
        (typeof responseBody === 'string'
          ? responseBody
          : 'An unexpected error occurred.'),
      path: request.path,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      // Credential operations must never log ORM arguments/hashes in a stack.
      // Express routes also accept case differences and a trailing slash.
      const routePath = request.path.toLowerCase().replace(/\/+$/, '');
      const credentialPath =
        routePath.startsWith('/v1/merchant/imports') ||
        routePath.startsWith('/v1/merchant/file-imports') ||
        routePath.startsWith('/v1/merchant/auth') ||
        routePath.startsWith('/v1/reviews/') ||
        routePath.startsWith('/v1/admin/reviews') ||
        /^\/v1\/products\/[^/]+\/reviews(?:\/mine)?$/.test(routePath) ||
        routePath.endsWith('/login');
      const stack =
        !credentialPath && exception instanceof Error
          ? exception.stack
          : undefined;
      this.logger.error(
        JSON.stringify({
          event: 'request_failed',
          method: request.method,
          path: request.path,
          status,
        }),
        stack,
      );
    }

    response.status(status).json(body);
  }
}
