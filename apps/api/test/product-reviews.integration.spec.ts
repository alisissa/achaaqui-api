import 'reflect-metadata';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import {
  ProductReviewsService,
  reviewIdentityHash,
} from '../src/reviews/product-reviews.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import type {
  OwnProductReviewDto,
  ProductReviewListDto,
} from '../src/reviews/product-reviews.dto';
import type {
  AdminReviewItemDto,
  AdminReviewSummaryDto,
} from '../src/reviews/reviews.dto';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Review tests require a localhost disposable test database.');
const run = url ? describe : describe.skip;
const require = createRequire(
  `${process.cwd()}/test/product-reviews.integration.spec.ts`,
);

run(
  'anonymous product reviews: HTTP, PostgreSQL uniqueness and moderation',
  () => {
    let prisma: PrismaService;
    let app: INestApplication;
    let base: string;
    let productId: string;
    let merchantId: string;
    let offerId: string;
    let categoryId: string;
    let brandId: string;
    let limiter: ThrottlerStorageService;
    let reviews: ProductReviewsService;
    let aggregates: ReviewsService;
    const prefix = `review-${randomUUID().slice(0, 8)}`;
    const token = randomBytes(32).toString('hex');
    const adminToken = randomBytes(32).toString('hex');
    const config = new ConfigService({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      ADMIN_AUTH_MODE: 'local-key',
      ADMIN_API_KEY: adminToken,
      PRODUCT_REVIEWS_ENABLED: true,
      MERCHANT_ACCESS_ENABLED: false,
      ANALYTICS_HASH_KEY: randomBytes(32).toString('hex'),
    });
    const headers = (identity?: string): Record<string, string> => ({
      'content-type': 'application/json',
      ...(identity ? { 'x-review-token': identity } : {}),
    });
    const submit = (
      identity: string | undefined,
      body: unknown,
      slug = prefix,
    ): Promise<Response> =>
      fetch(`${base}/products/${slug}/reviews`, {
        method: 'POST',
        headers: headers(identity),
        body: JSON.stringify(body),
      });
    const mine = (identity: string, slug = prefix): Promise<Response> =>
      fetch(`${base}/products/${slug}/reviews/mine`, {
        headers: headers(identity),
      });
    const moderate = (id: string, status: string): Promise<Response> =>
      fetch(`${base}/admin/reviews/${id}`, {
        method: 'PATCH',
        headers: { ...headers(), authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status }),
      });

    beforeAll(async () => {
      prisma = new PrismaService(config);
      await prisma.$connect();
      categoryId = (
        await prisma.category.create({ data: { name: prefix, slug: prefix } })
      ).id;
      brandId = (
        await prisma.brand.create({ data: { name: prefix, slug: prefix } })
      ).id;
      productId = (
        await prisma.product.create({
          data: { name: prefix, slug: prefix, brandId, categoryId },
        })
      ).id;
      merchantId = (
        await prisma.merchant.create({ data: { name: prefix, slug: prefix } })
      ).id;
      offerId = (
        await prisma.merchantProduct.create({
          data: {
            merchantId,
            productId,
            merchantSku: prefix,
            price: 100,
            currency: 'BRL',
            availability: 'IN_STOCK',
            sourceUpdatedAt: new Date(),
          },
        })
      ).id;
      await prisma.customerReview.create({
        data: {
          merchantProductId: offerId,
          productRating: 5,
          merchantRating: 3,
          status: 'PUBLISHED',
          comment: 'Legacy review',
        },
      });
      const { AppModule } =
        require('../dist/app.module.js') as typeof import('../src/app.module');
      const { PrismaService: CompiledPrisma } =
        require('../dist/database/prisma.service.js') as typeof import('../src/database/prisma.service');
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(CompiledPrisma)
        .useValue(prisma)
        .compile();
      app = module.createNestApplication({ logger: false });
      app.setGlobalPrefix('v1');
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      limiter = app.get<ThrottlerStorageService>(ThrottlerStorage);
      await app.listen(0, '127.0.0.1');
      base = `${await app.getUrl()}/v1`;
      reviews = new ProductReviewsService(prisma, config);
      aggregates = new ReviewsService(prisma);
    });
    beforeEach(() => limiter.storage.clear());
    afterAll(async () => {
      if (prisma) {
        await prisma.customerReview.deleteMany({
          where: {
            OR: [
              { product: { slug: { startsWith: prefix } } },
              { merchantProductId: offerId },
            ],
          },
        });
        await prisma.merchantProduct.deleteMany({ where: { merchantId } });
        await prisma.product.deleteMany({
          where: { slug: { startsWith: prefix } },
        });
        await prisma.merchant.deleteMany({ where: { id: merchantId } });
        await prisma.brand.deleteMany({ where: { id: brandId } });
        await prisma.category.deleteMany({ where: { id: categoryId } });
      }
      if (app) await app.close();
      if (prisma) await prisma.$disconnect();
    });

    it('issues bounded random credentials with no-store and returns JSON for no review yet', async () => {
      const response = await fetch(`${base}/reviews/identity`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const identity = (await response.json()) as { token: string };
      expect(identity.token).toMatch(/^[a-f0-9]{64}$/);
      expect(await (await mine(identity.token)).json()).toEqual({
        review: null,
      });
    });
    it('publishes stars/comment immediately, keeps identity private and preserves legacy ratings', async () => {
      const response = await submit(token, {
        rating: 4,
        comment: '  Gostei <script>literal</script>  ',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const created = (await response.json()) as OwnProductReviewDto;
      expect(created.status).toBe('PUBLISHED');
      expect(created.comment).toBe('Gostei <script>literal</script>');
      expect(Object.keys(created).sort()).toEqual(
        ['id', 'rating', 'comment', 'createdAt', 'status'].sort(),
      );
      const saved = await prisma.customerReview.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(saved.productId).toBe(productId);
      expect(saved.reviewerHash).toBe(reviewIdentityHash(token));
      expect(saved.merchantProductId).toBeNull();
      expect(saved.merchantRating).toBeNull();
      const result = await aggregates.productRatings([productId]);
      expect(result.get(productId)).toEqual({ average: 4.5, count: 2 });
      expect(
        (await aggregates.merchantRatings([merchantId])).get(merchantId),
      ).toEqual({ average: 3, count: 1 });
      const list = (await (
        await fetch(`${base}/products/${prefix}/reviews`)
      ).json()) as ProductReviewListDto;
      expect(list.total).toBe(2);
      expect(Object.keys(list.items[0]).sort()).toEqual(
        ['id', 'rating', 'comment', 'createdAt'].sort(),
      );
      expect(JSON.stringify(list)).not.toContain(saved.reviewerHash);
    });
    it('isolates each private identity and rejects missing/invalid credentials', async () => {
      expect(
        ((await (await mine(token)).json()) as { review: OwnProductReviewDto })
          .review.rating,
      ).toBe(4);
      expect(
        await (await mine(randomBytes(32).toString('hex'))).json(),
      ).toEqual({ review: null });
      expect((await submit(undefined, { rating: 4 })).status).toBe(401);
      expect((await submit('forged', { rating: 4 })).status).toBe(401);
      expect(
        (
          await fetch(`${base}/admin/reviews`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${base}/merchant/auth/me`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).not.toBe(200);
    });
    it('rejects score/comment violations and injected identity, merchant and moderation fields', async () => {
      for (const body of [
        { rating: 0 },
        { rating: 6 },
        { rating: 1.5 },
        { rating: 5, comment: 'x'.repeat(1001) },
        { rating: 5, status: 'PUBLISHED' },
        { rating: 5, reviewerHash: reviewIdentityHash(token) },
        { rating: 5, merchantProductId: offerId },
        { rating: 5, productId },
      ])
        expect((await submit(token, body)).status).toBe(400);
    });
    it('is idempotent on retries and simultaneous requests but disallows a second/different review', async () => {
      const identity = randomBytes(32).toString('hex');
      const responses = await Promise.all([
        submit(identity, { rating: 3 }),
        submit(identity, { rating: 3 }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const rows = (await Promise.all(
        responses.map((r) => r.json()),
      )) as OwnProductReviewDto[];
      expect(rows[0].id).toBe(rows[1].id);
      expect((await submit(identity, { rating: 5 })).status).toBe(409);
      expect(
        await prisma.customerReview.count({
          where: { productId, reviewerHash: reviewIdentityHash(identity) },
        }),
      ).toBe(1);
      await expect(
        prisma.customerReview.create({
          data: {
            productId,
            reviewerHash: reviewIdentityHash(identity),
            productRating: 5,
            status: 'PUBLISHED',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
    it('gives admins a product-only review without invented merchant ratings and can hide it', async () => {
      const own = (await (await mine(token)).json()) as {
        review: OwnProductReviewDto;
      };
      expect(
        (
          await fetch(`${base}/admin/reviews/${own.review.id}`, {
            method: 'PATCH',
            headers: headers(token),
            body: JSON.stringify({ status: 'REJECTED' }),
          })
        ).status,
      ).toBe(401);
      const hidden = await moderate(own.review.id, 'REJECTED');
      expect(hidden.status).toBe(200);
      const result = (await hidden.json()) as AdminReviewItemDto;
      expect(result.merchant).toBeNull();
      expect(result.merchantRating).toBeNull();
      expect(result.combinedRating).toBeNull();
      expect(result.product.id).toBe(productId);
      const list = (await (
        await fetch(`${base}/products/${prefix}/reviews`)
      ).json()) as ProductReviewListDto;
      expect(list.items.some((row) => row.id === own.review.id)).toBe(false);
      expect(
        (await submit(token, { rating: 5, comment: 'replacement' })).status,
      ).toBe(409);
      expect(
        ((await (await mine(token)).json()) as { review: OwnProductReviewDto })
          .review.status,
      ).toBe('REJECTED');
      expect(
        (await aggregates.productRatings([productId])).get(productId),
      ).toEqual({ average: 4, count: 2 });
      const summary = (await (
        await fetch(`${base}/admin/reviews/summary`, {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).json()) as AdminReviewSummaryDto;
      expect(summary.publishedMerchantRating).toEqual({ average: 3, count: 1 });
      const adminList = await fetch(`${base}/admin/reviews?q=${prefix}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(adminList.status).toBe(200);
      expect(((await adminList.json()) as { total: number }).total).toBe(3);
    });
    it('validates pagination, rejects inactive products and leaves no partial review', async () => {
      expect(
        (await fetch(`${base}/products/${prefix}/reviews?pageSize=101`)).status,
      ).toBe(400);
      expect(
        (await fetch(`${base}/products/${prefix}/reviews?page=0`)).status,
      ).toBe(400);
      const inactive = await prisma.product.create({
        data: {
          name: prefix,
          slug: `${prefix}-inactive`,
          brandId,
          categoryId,
          status: 'INACTIVE',
        },
      });
      expect(
        (
          await submit(
            randomBytes(32).toString('hex'),
            { rating: 5 },
            `${prefix}-inactive`,
          )
        ).status,
      ).toBe(404);
      expect(
        await prisma.customerReview.count({
          where: { productId: inactive.id },
        }),
      ).toBe(0);
    });
    it('enforces the identity-wide hourly quota transactionally across different products', async () => {
      const identity = randomBytes(32).toString('hex');
      const products = await Promise.all(
        Array.from({ length: 11 }, (_, index) =>
          prisma.product.create({
            data: {
              name: prefix,
              slug: `${prefix}-quota-${index}`,
              brandId,
              categoryId,
            },
          }),
        ),
      );
      const results = await Promise.allSettled(
        products.map((product) =>
          reviews.create(product.slug, identity, { rating: 5 }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      const failed = results.find((r) => r.status === 'rejected');
      expect(
        failed?.status === 'rejected' &&
          (failed.reason as { getStatus(): number }).getStatus(),
      ).toBe(429);
      expect(
        await prisma.customerReview.count({
          where: { reviewerHash: reviewIdentityHash(identity) },
        }),
      ).toBe(10);
    });
    it('has HTTP issuance throttling and an off switch without altering stored reviews', async () => {
      for (let index = 0; index < 10; index++)
        expect(
          (await fetch(`${base}/reviews/identity`, { method: 'POST' })).status,
        ).toBe(200);
      expect(
        (await fetch(`${base}/reviews/identity`, { method: 'POST' })).status,
      ).toBe(429);
      limiter.storage.clear();
      config.set('PRODUCT_REVIEWS_ENABLED', false);
      expect(
        (await fetch(`${base}/reviews/identity`, { method: 'POST' })).status,
      ).toBe(404);
      expect((await submit(token, { rating: 4 })).status).toBe(404);
      expect((await mine(token)).status).toBe(404);
      expect((await fetch(`${base}/products/${prefix}/reviews`)).status).toBe(
        404,
      );
      config.set('PRODUCT_REVIEWS_ENABLED', true);
    });
  },
);
