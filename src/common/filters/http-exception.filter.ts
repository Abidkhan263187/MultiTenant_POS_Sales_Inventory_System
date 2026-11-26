import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { postgresErrorCode } from '../postgres-error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapped = this.mapException(exception);
    if (mapped.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(mapped.status).json({
      statusCode: mapped.status,
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    message: string | string[];
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message: string | string[] = exception.message;
      let code = defaultCode(status);
      let details: Record<string, unknown> | undefined;

      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.message === 'string' || Array.isArray(record.message)) {
          message = record.message as string | string[];
        }
        if (typeof record.code === 'string') {
          code = record.code;
        }
        const extra: Record<string, unknown> = {};
        for (const key of ['productId', 'available', 'requested']) {
          if (record[key] !== undefined) {
            extra[key] = record[key];
          }
        }
        if (Object.keys(extra).length > 0) {
          details = extra;
        }
      }

      return { status, code, message, details };
    }

    const dbCode = postgresErrorCode(exception);
    if (dbCode === '23505') {
      return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'Duplicate record' };
    }
    if (dbCode === '40P01' || dbCode === '40001') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONCURRENT_CONFLICT',
        message: 'Concurrent update conflict. Please retry.',
      };
    }
    if (dbCode === '22P02') {
      return { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR', message: 'Invalid identifier' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.PAYMENT_REQUIRED:
      return 'PAYMENT_FAILED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}
