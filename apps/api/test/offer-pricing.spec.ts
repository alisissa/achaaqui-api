import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import {
  effectivePrice,
  publicCommercial,
} from '../src/commercial/offer-pricing';
import { normalizeSearch } from '../src/products/catalog-search';
describe('effective commercial prices', () => {
  const end = new Date('2026-10-01T10:00:00Z');
  const offer = {
    price: new Prisma.Decimal('100'),
    currency: 'BRL',
    salePrice: new Prisma.Decimal('80'),
    saleEndsAt: end,
    promotionText: 'Leve 2',
    promotionEndsAt: end,
  };
  it('applies the sale before but never at or after the exact deadline', () => {
    expect(effectivePrice(offer, new Date(end.getTime() - 1)).toString()).toBe(
      '80',
    );
    expect(effectivePrice(offer, end).toString()).toBe('100');
    expect(publicCommercial(offer, end)).toEqual({
      regularPrice: null,
      saleEndsAt: null,
      promotion: null,
    });
  });
  it('keeps promotions separate from the amount and supports no expiry', () => {
    const active = { ...offer, saleEndsAt: null, promotionEndsAt: null };
    expect(publicCommercial(active, end).promotion?.text).toBe('Leve 2');
    expect(effectivePrice({ ...active, salePrice: null }, end).toString()).toBe(
      '100',
    );
  });
  it('normalizes accents and letter-number spacing without dropping numeric identity', () => {
    expect(normalizeSearch('  iPhone15 / Edição 128GB ')).toBe(
      'iphone 15 edicao 128 gb',
    );
    expect(normalizeSearch('iPhone16')).not.toBe(normalizeSearch('iPhone15'));
  });
});
