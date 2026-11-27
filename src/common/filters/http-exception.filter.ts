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
        for (const key of ['productId', 'available', 'requested', 'errors']) {
          if (record[key] !== undefined) {
            extra[key] = record[key];
          }
        }
        if (Object.keys(extra).length > 0) {
          details = extra;
        }
      }

      return { status, code, message: friendlyMessage(message), details };
    }

    const dbCode = postgresErrorCode(exception);
    if (dbCode === '23505') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'That record already exists. Use a different value.',
      };
    }
    if (dbCode === '40P01' || dbCode === '40001') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONCURRENT_CONFLICT',
        message: 'Someone else updated this at the same time. Please try again.',
      };
    }
    if (dbCode === '22P02') {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'That id is not valid. Copy the store, product, or sale id from the list.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong while saving this. Please try again.',
    };
  }
}

function friendlyMessage(message: string | string[]): string {
  const text = Array.isArray(message) ? message.join(' ') : message;
  if (/uuid is expected/i.test(text)) {
    return 'That id is not valid. Copy the store, product, or sale id from the list.';
  }
  if (/unexpected token|entity\.parse|not valid json/i.test(text)) {
    return 'The request body is not valid JSON.';
  }
  if (text === 'Unauthorized') {
    return 'Sign in again. The login token is missing or no longer valid.';
  }
  return text;
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
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}
