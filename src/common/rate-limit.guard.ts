import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { RateLimitWindow } from './rate-limit';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly loginByIp: RateLimitWindow;
  private readonly loginByEmail: RateLimitWindow;
  private readonly apiByIp: RateLimitWindow;

  constructor(config: ConfigService) {
    this.loginByIp = new RateLimitWindow(
      positive(config.get<string>('LOGIN_RATE_LIMIT'), 30),
      positive(config.get<string>('LOGIN_RATE_WINDOW_SECONDS'), 900) * 1000,
    );
    this.loginByEmail = new RateLimitWindow(
      positive(config.get<string>('LOGIN_EMAIL_RATE_LIMIT'), 20),
      positive(config.get<string>('LOGIN_EMAIL_RATE_WINDOW_SECONDS'), 900) * 1000,
    );
    this.apiByIp = new RateLimitWindow(
      positive(config.get<string>('API_RATE_LIMIT'), 300),
      positive(config.get<string>('API_RATE_WINDOW_SECONDS'), 60) * 1000,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';

    if (isLogin(request)) {
      const email = loginEmail(request.body);
      const ipResult = this.loginByIp.take(`login:${ip}`);
      const emailResult = email ? this.loginByEmail.take(`login-email:${email}`) : { allowed: true as const };
      if (!ipResult.allowed || !emailResult.allowed) {
        const retryAfterSeconds = Math.max(
          ipResult.allowed ? 0 : ipResult.retryAfterSeconds,
          emailResult.allowed ? 0 : emailResult.retryAfterSeconds,
        );
        response.setHeader('Retry-After', String(retryAfterSeconds));
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: `Too many login attempts. Wait ${retryAfterSeconds} seconds and try again.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    }

    const result = this.apiByIp.take(`api:${ip}`);
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many requests. Wait ${result.retryAfterSeconds} seconds and try again.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

function isLogin(request: Request): boolean {
  if (request.method !== 'POST') {
    return false;
  }
  const path = (request.originalUrl || request.url || '').split('?')[0];
  return path.endsWith('/auth/login');
}

function loginEmail(body: unknown): string {
  if (!body || typeof body !== 'object' || !('email' in body)) {
    return '';
  }
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
