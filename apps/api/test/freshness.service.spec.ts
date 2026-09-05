import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { FreshnessService } from '../src/common/freshness/freshness.service';

function service(): FreshnessService {
  return new FreshnessService(
    new ConfigService({
      FRESHNESS_AGING_HOURS: 72,
      FRESHNESS_STALE_HOURS: 168,
    }),
  );
}

describe('FreshnessService', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('should mark a recently updated offer as fresh', () => {
    const result = service().forOffer(
      'IN_STOCK',
      new Date('2026-08-31T11:00:00.000Z'),
      now,
    );

    expect(result.status).toBe('FRESH');
  });

  it('should mark an aging offer using configured thresholds', () => {
    const result = service().forOffer(
      'UNKNOWN',
      new Date('2026-08-27T12:00:00.000Z'),
      now,
    );

    expect(result.status).toBe('AGING');
  });

  it('should mark an out-of-stock offer unavailable regardless of age', () => {
    const result = service().forOffer(
      'OUT_OF_STOCK',
      new Date('2026-08-31T11:55:00.000Z'),
      now,
    );

    expect(result.status).toBe('UNAVAILABLE');
  });

  it('should use the most recent available offer for a product', () => {
    const result = service().forProduct(
      [
        {
          availability: 'OUT_OF_STOCK',
          sourceUpdatedAt: new Date('2026-08-31T11:30:00.000Z'),
        },
        {
          availability: 'IN_STOCK',
          sourceUpdatedAt: new Date('2026-08-20T12:00:00.000Z'),
        },
      ],
      now,
    );

    expect(result?.status).toBe('STALE');
  });
});
