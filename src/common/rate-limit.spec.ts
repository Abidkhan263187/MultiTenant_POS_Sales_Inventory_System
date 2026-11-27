import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitWindow } from './rate-limit';

describe('rate limit', () => {
  it('allows requests inside the window and blocks the next one', () => {
    const window = new RateLimitWindow(2, 60_000);
    expect(window.take('till', 1_000).allowed).toBe(true);
    expect(window.take('till', 1_100).allowed).toBe(true);
    const blocked = window.take('till', 1_200);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(window.take('other-till', 1_200).allowed).toBe(true);
  });

  it('blocks login after the address limit and leaves another address alone', () => {
    const guard = new RateLimitGuard(config({ LOGIN_RATE_LIMIT: '2', LOGIN_EMAIL_RATE_LIMIT: '10' }));
    const first = http({ ip: '10.0.0.1', email: 'cashier@pos.test' });
    const second = http({ ip: '10.0.0.1', email: 'cashier@pos.test' });
    const third = http({ ip: '10.0.0.1', email: 'other@pos.test' });
    const elsewhere = http({ ip: '10.0.0.2', email: 'cashier@pos.test' });

    expect(guard.canActivate(first.context)).toBe(true);
    expect(guard.canActivate(second.context)).toBe(true);
    expect(() => guard.canActivate(third.context)).toThrow(HttpException);
    expect(third.response.getHeader('Retry-After')).toBeDefined();
    expect(guard.canActivate(elsewhere.context)).toBe(true);
  });

  it('blocks repeated attempts for one email from different addresses', () => {
    const guard = new RateLimitGuard(config({ LOGIN_RATE_LIMIT: '20', LOGIN_EMAIL_RATE_LIMIT: '1' }));
    expect(guard.canActivate(http({ ip: '10.0.0.1', email: 'Abid@pos.test' }).context)).toBe(true);
    expect(() => guard.canActivate(http({ ip: '10.0.0.9', email: 'abid@pos.test' }).context)).toThrow(HttpException);
  });
});

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function http(input: { ip: string; email: string }) {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    getHeader(name: string) {
      return headers.get(name);
    },
  };
  const request = {
    method: 'POST',
    originalUrl: '/api/auth/login',
    ip: input.ip,
    body: { email: input.email },
    socket: { remoteAddress: input.ip },
  };
  return {
    response,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as never,
  };
}
