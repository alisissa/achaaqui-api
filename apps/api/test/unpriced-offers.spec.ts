import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import { normalizeImportRecord } from '../src/imports/import-normalization';
import {
  effectivePrice,
  publicPrice,
  publicCommercial,
} from '../src/commercial/offer-pricing';
import {
  lowestPricesByCurrency,
  orderedOffers,
} from '../src/products/products.service';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/database/prisma.service';

const unpriced = {
  price: null,
  currency: 'BRL',
  availability: 'UNKNOWN' as const,
};
describe('explicit unpriced listings', () => {
  it('never emits zero, a discount, or a best price for an unknown amount', () => {
    expect(effectivePrice(unpriced)).toBeNull();
    expect(publicPrice(unpriced)).toBeNull();
    expect(
      publicCommercial({ ...unpriced, salePrice: new Prisma.Decimal(10) })
        .regularPrice,
    ).toBeNull();
    expect(lowestPricesByCurrency([unpriced])).toEqual([]);
    const priced = { ...unpriced, price: new Prisma.Decimal(25) };
    expect(lowestPricesByCurrency([unpriced, priced])).toEqual([
      { amount: '25', currency: 'BRL' },
    ]);
    expect(orderedOffers([unpriced, priced])).toEqual([priced, unpriced]);
  });
  it('keeps missing prices blocked in imports, even if a file supplies an unpriced flag', () => {
    const record = {
      merchantSku: 'A',
      productName: 'Produto',
      price: '',
      currency: 'BRL',
      priceOnRequest: true,
    };
    expect(
      normalizeImportRecord(record, new Set(['BRL'])).errors.length,
    ).toBeGreaterThan(0);
    expect(
      normalizeImportRecord(record, new Set(['BRL']), {
        allowMissingPrice: true,
      }).errors,
    ).toEqual([]);
    for (const price of ['0', '-1', 'abc']) {
      expect(
        normalizeImportRecord({ ...record, price }, new Set(['BRL']), {
          allowMissingPrice: true,
        }).errors.length,
      ).toBeGreaterThan(0);
    }
  });
  it('requires explicit confirmation and rejects contradictory manual amounts before accessing the database', async () => {
    const service = new MerchantOffersService(
      {} as PrismaService,
      new ConfigService(),
    );
    const input = {
      productId: 'product',
      merchantSku: 'A',
      currency: 'BRL',
      availability: 'UNKNOWN' as const,
      confirmed: true,
      confirmWarnings: true,
    };
    await expect(
      service.create('store', { ...input, price: '' }),
    ).rejects.toThrow();
    await expect(
      service.create('store', {
        ...input,
        price: '',
        priceOnRequest: true,
        confirmed: false,
      }),
    ).rejects.toThrow('Confirm');
    await expect(
      service.create('store', { ...input, price: '100', priceOnRequest: true }),
    ).rejects.toThrow('Leave price blank');
  });
});
