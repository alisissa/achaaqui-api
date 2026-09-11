interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  TRUST_PROXY_HOPS: number;
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECTION_TIMEOUT_MS: number;
  DATABASE_IDLE_TIMEOUT_MS: number;
  CORS_ORIGINS: string;
  SWAGGER_ENABLED: boolean;
  FRESHNESS_AGING_HOURS: number;
  FRESHNESS_STALE_HOURS: number;
  ADMIN_API_KEY: string;
  ANALYTICS_HASH_KEY: string;
  ANALYTICS_RETENTION_DAYS: number;
  IMPORT_SUPPORTED_CURRENCIES: string;
  IMPORT_SUSPICIOUS_CHANGE_PERCENT: number;
  IMPORT_MAX_ROWS: number;
  IMPORT_MAX_FILE_BYTES: number;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  variableName: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsed;
}

function nonNegativeInteger(
  value: unknown,
  fallback: number,
  variableName: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${variableName} must be a non-negative integer.`);
  }
  return parsed;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error('Boolean configuration values must be true or false.');
  }

  return value.toLowerCase() === 'true';
}

function secretValue(value: unknown, variableName: string): string {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${variableName} must contain at least 32 characters.`);
  }
  if (/^replace-with-/i.test(value)) {
    throw new Error(`${variableName} must not use the example placeholder.`);
  }

  return value;
}

function currencyList(value: unknown): string {
  const rawCurrencies = value ?? 'BRL,USD,PYG';
  if (typeof rawCurrencies !== 'string') {
    throw new Error('IMPORT_SUPPORTED_CURRENCIES must be a string.');
  }
  const currencies = rawCurrencies
    .split(',')
    .map((currency) => currency.trim().toUpperCase())
    .filter(Boolean);
  if (
    currencies.length === 0 ||
    currencies.some((currency) => !/^[A-Z]{3}$/.test(currency))
  ) {
    throw new Error(
      'IMPORT_SUPPORTED_CURRENCIES must be a comma-separated list of ISO currency codes.',
    );
  }
  return [...new Set(currencies)].join(',');
}

export function validateEnvironment(
  rawEnvironment: Record<string, unknown>,
): Environment {
  const rawNodeEnvironment = rawEnvironment.NODE_ENV;
  const nodeEnvironment =
    rawNodeEnvironment === undefined ? 'development' : rawNodeEnvironment;
  if (
    typeof nodeEnvironment !== 'string' ||
    !['development', 'test', 'production'].includes(nodeEnvironment)
  ) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const databaseUrl = rawEnvironment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl.startsWith('postgres')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }

  const corsOrigins = rawEnvironment.CORS_ORIGINS;
  if (typeof corsOrigins !== 'string' || corsOrigins.trim().length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one explicit origin.');
  }

  const agingHours = positiveInteger(
    rawEnvironment.FRESHNESS_AGING_HOURS,
    72,
    'FRESHNESS_AGING_HOURS',
  );
  const staleHours = positiveInteger(
    rawEnvironment.FRESHNESS_STALE_HOURS,
    168,
    'FRESHNESS_STALE_HOURS',
  );
  if (agingHours >= staleHours) {
    throw new Error(
      'FRESHNESS_AGING_HOURS must be lower than FRESHNESS_STALE_HOURS.',
    );
  }

  return {
    NODE_ENV: nodeEnvironment as Environment['NODE_ENV'],
    PORT: positiveInteger(rawEnvironment.PORT, 3000, 'PORT'),
    TRUST_PROXY_HOPS: nonNegativeInteger(
      rawEnvironment.TRUST_PROXY_HOPS,
      0,
      'TRUST_PROXY_HOPS',
    ),
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: positiveInteger(
      rawEnvironment.DATABASE_POOL_MAX,
      10,
      'DATABASE_POOL_MAX',
    ),
    DATABASE_CONNECTION_TIMEOUT_MS: positiveInteger(
      rawEnvironment.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
      'DATABASE_CONNECTION_TIMEOUT_MS',
    ),
    DATABASE_IDLE_TIMEOUT_MS: positiveInteger(
      rawEnvironment.DATABASE_IDLE_TIMEOUT_MS,
      10_000,
      'DATABASE_IDLE_TIMEOUT_MS',
    ),
    CORS_ORIGINS: corsOrigins,
    SWAGGER_ENABLED: booleanValue(
      rawEnvironment.SWAGGER_ENABLED,
      nodeEnvironment === 'development',
    ),
    FRESHNESS_AGING_HOURS: agingHours,
    FRESHNESS_STALE_HOURS: staleHours,
    ADMIN_API_KEY: secretValue(rawEnvironment.ADMIN_API_KEY, 'ADMIN_API_KEY'),
    ANALYTICS_HASH_KEY: secretValue(
      rawEnvironment.ANALYTICS_HASH_KEY,
      'ANALYTICS_HASH_KEY',
    ),
    ANALYTICS_RETENTION_DAYS: positiveInteger(
      rawEnvironment.ANALYTICS_RETENTION_DAYS,
      90,
      'ANALYTICS_RETENTION_DAYS',
    ),
    IMPORT_SUPPORTED_CURRENCIES: currencyList(
      rawEnvironment.IMPORT_SUPPORTED_CURRENCIES,
    ),
    IMPORT_SUSPICIOUS_CHANGE_PERCENT: positiveInteger(
      rawEnvironment.IMPORT_SUSPICIOUS_CHANGE_PERCENT,
      50,
      'IMPORT_SUSPICIOUS_CHANGE_PERCENT',
    ),
    IMPORT_MAX_ROWS: positiveInteger(
      rawEnvironment.IMPORT_MAX_ROWS,
      500,
      'IMPORT_MAX_ROWS',
    ),
    IMPORT_MAX_FILE_BYTES: positiveInteger(
      rawEnvironment.IMPORT_MAX_FILE_BYTES,
      2_097_152,
      'IMPORT_MAX_FILE_BYTES',
    ),
  };
}
