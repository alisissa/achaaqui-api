import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';

const { adapterConstructor } = vi.hoisted(() => ({
  adapterConstructor: vi.fn(),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options: unknown) {
      adapterConstructor(options);
    }
  },
}));

vi.mock('../src/generated/prisma/client', () => ({
  PrismaClient: class {},
}));

describe('PrismaService pool configuration', () => {
  beforeEach(() => adapterConstructor.mockClear());

  it('should pass explicit pool limits to the PostgreSQL driver', () => {
    const connectionString = 'postgresql://test:test@localhost:5432/test';
    const config = new ConfigService({
      DATABASE_URL: connectionString,
      DATABASE_POOL_MAX: 5,
      DATABASE_CONNECTION_TIMEOUT_MS: 15_000,
      DATABASE_IDLE_TIMEOUT_MS: 20_000,
    });

    new PrismaService(config);

    expect(adapterConstructor).toHaveBeenCalledExactlyOnceWith({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 20_000,
    });
  });

  it('should preserve TLS URL options and apply bounded defaults', () => {
    const connectionString =
      'postgresql://test:test@example.invalid/test?sslmode=verify-full';

    new PrismaService(new ConfigService({ DATABASE_URL: connectionString }));

    expect(adapterConstructor).toHaveBeenCalledExactlyOnceWith({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    });
  });

  it('should fail before constructing a pool when the database URL is missing', () => {
    const config = new ConfigService();
    config.get = vi.fn().mockReturnValue(undefined);

    expect(() => new PrismaService(config)).toThrow(
      'DATABASE_URL is not configured.',
    );
    expect(adapterConstructor).not.toHaveBeenCalled();
  });
});
