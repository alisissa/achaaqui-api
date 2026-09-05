import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProductListQueryDto, ProductSort } from '../src/products/products.dto';

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
