import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ConflictException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { CreateProductReviewDto } from '../src/reviews/product-reviews.dto';
import {
  ProductReviewsService,
  reviewIdentityHash,
} from '../src/reviews/product-reviews.service';

describe('product review boundaries', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (value: unknown): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: CreateProductReviewDto });
  it('maps a database uniqueness race to a safe conflict', async () => {
    const prisma = {
      $transaction: (): Promise<never> => {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('private database detail', {
            code: 'P2002',
            clientVersion: '7.10.0',
          }),
        );
      },
    } as unknown as PrismaService;
    const service = new ProductReviewsService(
      prisma,
      new ConfigService({ PRODUCT_REVIEWS_ENABLED: true }),
    );
    await expect(
      service.create('product', 'a'.repeat(64), { rating: 5 }),
    ).rejects.toThrow(ConflictException);
  });
  it('hashes a private identity deterministically without exposing the credential', () => {
    const token = 'a'.repeat(64);
    expect(reviewIdentityHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewIdentityHash(token)).not.toBe(token);
    expect(reviewIdentityHash(token)).toBe(reviewIdentityHash(token));
    for (const invalid of [
      undefined,
      '',
      'b'.repeat(63),
      'b'.repeat(65),
      'z'.repeat(64),
      `Bearer ${token}`,
    ])
      expect(() => reviewIdentityHash(invalid)).toThrow();
  });
  it('accepts integer stars and trims but does not translate optional comments', async () => {
    expect(
      await validate({ rating: 5, comment: '  Muito bom <literal>  ' }),
    ).toEqual({ rating: 5, comment: 'Muito bom <literal>' });
    expect(await validate({ rating: 1 })).toEqual({ rating: 1 });
  });
  it('rejects invalid scores, oversized comments and client-controlled publication or identity', async () => {
    for (const body of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: '5' },
      {},
      { rating: 5, comment: 'x'.repeat(1001) },
      { rating: 5, status: 'PUBLISHED' },
      { rating: 5, reviewerHash: 'a'.repeat(64) },
      { rating: 5, merchantProductId: 'fake' },
      { rating: 5, comment: {} },
    ])
      await expect(validate(body)).rejects.toThrow();
  });
});
