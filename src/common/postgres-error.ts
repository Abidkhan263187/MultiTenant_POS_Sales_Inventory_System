export function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const candidate = error as { code?: string; driverError?: { code?: string } };
  return candidate.driverError?.code ?? candidate.code;
}

export function postgresErrorField(error: unknown, field: 'message' | 'detail'): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const record = error as Record<string, unknown>;
  const driver = record.driverError as Record<string, unknown> | undefined;
  const value = driver?.[field] ?? record[field];
  return typeof value === 'string' ? value : '';
}

export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === '23505';
}

export function isDeadlock(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code === '40P01' || code === '40001';
}
