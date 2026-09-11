import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProductListQueryDto, ProductSort } from '../src/products/products.dto';
import {
  CreateMerchantOfferDto,
  RemoveMerchantOfferDto,
} from '../src/merchants/merchant-offers.dto';

function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('public query validation', () => {
  it('should transform supported pagination and sort input', async () => {
    const result: unknown = await validationPipe().transform(
      { page: '2', pageSize: '12', sort: 'recent' },
      { type: 'query', metatype: ProductListQueryDto },
    );

    expect(result).toMatchObject({
      page: 2,
      pageSize: 12,
      sort: ProductSort.RECENT,
    });
  });

  it('should reject unknown query fields', async () => {
    await expect(
      validationPipe().transform(
        { unsupported: 'true' },
        { type: 'query', metatype: ProductListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject invalid pagination boundaries', async () => {
    await expect(
      validationPipe().transform(
        { page: '0', pageSize: '101' },
        { type: 'query', metatype: ProductListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('merchant mutation validation', () => {
  const body = {
    productId: '00000000-0000-4000-8000-000000000001',
    merchantSku: 'SKU-001',
    price: '100.00',
    currency: 'BRL',
    stock: '1',
    availability: 'IN_STOCK',
    confirmed: true,
  };

  it('requires a literal boolean confirmation, not a truthy string', async () => {
    for (const confirmed of [undefined, false, 'true', 'false', 1]) {
      await expect(
        validationPipe().transform(
          { ...body, confirmed },
          { type: 'body', metatype: CreateMerchantOfferDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      validationPipe().transform(body, {
        type: 'body',
        metatype: CreateMerchantOfferDto,
      }),
    ).resolves.toMatchObject({ confirmed: true, confirmWarnings: false });
  });

  it('rejects forged actor or merchant fields and invalid nested product input', async () => {
    for (const extra of [
      { actorId: 'forged' },
      { merchantId: body.productId },
      { newProduct: { name: 'Test', brand: 'Brand', categoryId: 'invalid' } },
    ]) {
      await expect(
        validationPipe().transform(
          { ...body, ...extra },
          { type: 'body', metatype: CreateMerchantOfferDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('requires a valid version and explicit confirmation for removal', async () => {
    await expect(
      validationPipe().transform(
        { confirmed: true },
        { type: 'body', metatype: RemoveMerchantOfferDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validationPipe().transform(
        { confirmed: true, expectedUpdatedAt: '2026-09-06T12:00:00.000Z' },
        { type: 'body', metatype: RemoveMerchantOfferDto },
      ),
    ).resolves.toMatchObject({ confirmed: true });
  });
});
