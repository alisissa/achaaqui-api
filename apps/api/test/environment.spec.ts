import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://catalog:catalog@localhost:5432/catalog',
  CORS_ORIGINS: 'http://localhost:8081',
  FRESHNESS_AGING_HOURS: '72',
  FRESHNESS_STALE_HOURS: '168',
  ADMIN_API_KEY: 'test-admin-key-that-is-at-least-32-characters',
  ANALYTICS_HASH_KEY: 'test-analytics-key-that-is-at-least-32-characters',
  ANALYTICS_RETENTION_DAYS: '90',
};

describe('validateEnvironment', () => {
  it('should transform valid string configuration', () => {
    const environment = validateEnvironment(validEnvironment);

    expect(environment.PORT).toBe(3000);
    expect(environment.FRESHNESS_AGING_HOURS).toBe(72);
    expect(environment.ANALYTICS_RETENTION_DAYS).toBe(90);
  });

  it('should reject non-PostgreSQL database URLs', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'file:./local.db',
      }),
    ).toThrow('DATABASE_URL must be a PostgreSQL connection URL.');
  });

  it('should reject freshness thresholds in the wrong order', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        FRESHNESS_AGING_HOURS: '200',
      }),
    ).toThrow(
      'FRESHNESS_AGING_HOURS must be lower than FRESHNESS_STALE_HOURS.',
    );
  });

  it('should reject short administrative secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        ADMIN_API_KEY: 'too-short',
      }),
    ).toThrow('ADMIN_API_KEY must contain at least 32 characters.');
  });

  it('should reject copied example secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        ADMIN_API_KEY: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('ADMIN_API_KEY must not use the example placeholder.');
  });

  it('should disable Swagger by default outside development', () => {
    const environment = validateEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
    });

    expect(environment.SWAGGER_ENABLED).toBe(false);
  });
});
