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
import { ReviewSafetyService } from '../src/reviews/review-safety.service';
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
    const banHashes: string[] = [];
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
        await prisma.reviewDeletionReceipt.deleteMany({
          where: { reviewerHash: { in: banHashes } },
        });
        await prisma.reviewBlock.deleteMany({
          where: {
            OR: [
              { blockedReviewerHash: { in: banHashes } },
              {
                review: {
                  OR: [
                    { product: { slug: { startsWith: prefix } } },
                    { merchantProductId: offerId },
                  ],
                },
              },
            ],
          },
        });
        await prisma.reviewerBan.deleteMany({
          where: { reviewerHash: { in: banHashes } },
        });
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
    it('deletes only the authenticated author review after confirmation, idempotently, without stale retries deleting a replacement', async () => {
      const owner = randomBytes(32).toString('hex');
      const other = randomBytes(32).toString('hex');
      const hash = reviewIdentityHash(owner);
      banHashes.push(hash);
      const created = await reviews.create(prefix, owner, {
        rating: 5,
        comment: 'Withdrawal test',
      });
      const remove = (
        identity: string | undefined,
        confirmed = true,
        slug = prefix,
      ): Promise<Response> =>
        fetch(`${base}/products/${slug}/reviews/mine`, {
          method: 'DELETE',
          headers: headers(identity),
          body: JSON.stringify({ reviewId: created.id, confirmed }),
        });
      expect((await remove(undefined)).status).toBe(401);
      expect((await remove(owner, false)).status).toBe(400);
      expect((await remove(other)).status).toBe(204);
      expect((await remove(owner, true, 'another-product')).status).toBe(204);
      expect(
        await prisma.customerReview.count({ where: { id: created.id } }),
      ).toBe(1);
      const before =
        (await aggregates.productRatings([productId])).get(productId)?.count ??
        0;
      const results = await Promise.all([remove(owner), remove(owner)]);
      expect(results.map((r) => r.status)).toEqual([204, 204]);
      expect(results[0]?.headers.get('cache-control')).toBe(
        'private, no-store',
      );
      expect(
        await prisma.customerReview.count({ where: { id: created.id } }),
      ).toBe(0);
      expect(
        await prisma.reviewDeletionReceipt.count({
          where: { reviewerHash: hash },
        }),
      ).toBe(1);
      expect(
        (await aggregates.productRatings([productId])).get(productId)?.count ??
          0,
      ).toBe(before - 1);
      const replacement = await reviews.create(prefix, owner, { rating: 4 });
      expect((await remove(owner)).status).toBe(204);
      expect(
        await prisma.customerReview.count({ where: { id: replacement.id } }),
      ).toBe(1);
      await reviews.deleteMine(prefix, owner, replacement.id);
    });

    it('preserves author blocks and bans when hidden reviews are deleted, even on inactive products', async () => {
      const owner = randomBytes(32).toString('hex');
      const blocker = randomBytes(32).toString('hex');
      const hash = reviewIdentityHash(owner);
      banHashes.push(hash);
      const created = await reviews.create(prefix, owner, { rating: 4 });
      await new ReviewSafetyService(prisma, config).save(created.id, blocker);
      await prisma.reviewerBan.create({
        data: {
          reviewerHash: hash,
          active: true,
          revision: randomUUID(),
          updatedBy: 'test-admin',
        },
      });
      await prisma.customerReview.update({
        where: { id: created.id },
        data: { status: 'REJECTED' },
      });
      await prisma.product.update({
        where: { id: productId },
        data: { status: 'INACTIVE' },
      });
      try {
        await reviews.deleteMine(prefix, owner, created.id);
      } finally {
        await prisma.product.update({
          where: { id: productId },
          data: { status: 'ACTIVE' },
        });
      }
      expect(
        await prisma.reviewBlock.findFirst({
          where: { blockerHash: reviewIdentityHash(blocker) },
          select: { reviewId: true, blockedReviewerHash: true },
        }),
      ).toEqual({ reviewId: null, blockedReviewerHash: hash });
      await expect(
        reviews.create(prefix, owner, { rating: 2 }),
      ).rejects.toThrow('cannot submit');
      expect(
        (await prisma.reviewerBan.findUnique({ where: { reviewerHash: hash } }))
          ?.active,
      ).toBe(true);
    });

    it('does not let delete and repost reset the hourly submission quota', async () => {
      const owner = randomBytes(32).toString('hex');
      const hash = reviewIdentityHash(owner);
      banHashes.push(hash);
      for (let i = 0; i < 10; i++) {
        const row = await reviews.create(prefix, owner, { rating: 3 });
        await reviews.deleteMine(prefix, owner, row.id);
      }
      await expect(
        reviews.create(prefix, owner, { rating: 3 }),
      ).rejects.toThrow('Please wait');
    });
    it('serializes deletion with report/block writes without dangling references or database errors', async () => {
      const safety = new ReviewSafetyService(prisma, config);
      for (const report of [undefined, { reason: 'ABUSE' as const }]) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const owner = randomBytes(32).toString('hex');
          const viewer = randomBytes(32).toString('hex');
          banHashes.push(reviewIdentityHash(owner));
          const row = await reviews.create(prefix, owner, { rating: 3 });
          const results = await Promise.allSettled([
            reviews.deleteMine(prefix, owner, row.id),
            safety.save(row.id, viewer, report),
          ]);
          expect(results[0]?.status).toBe('fulfilled');
          if (results[1]?.status === 'rejected')
            expect(results[1].reason).toMatchObject({ status: 404 });
          expect(
            await prisma.customerReview.count({ where: { id: row.id } }),
          ).toBe(0);
          expect(
            await prisma.reviewReport.count({ where: { reviewId: row.id } }),
          ).toBe(0);
          await safety.clearBlocks(viewer);
        }
      }
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
    const safetyRequest = (
      id: string,
      action: 'report' | 'block',
      identity?: string,
      body?: unknown,
    ): Promise<Response> =>
      fetch(`${base}/reviews/${id}/${action}`, {
        method: 'POST',
        headers: headers(identity),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const safetyReview = async (
      identity = randomBytes(32).toString('hex'),
    ): Promise<{
      review: { id: string; reviewerHash: string | null };
      identity: string;
    }> => {
      const review = await prisma.customerReview.create({
        data: {
          productId,
          productRating: 4,
          status: 'PUBLISHED',
          reviewerHash: reviewIdentityHash(identity),
          comment: 'Review safety fixture',
        },
      });
      return { review, identity };
    };

    it('accepts concurrent reports once without changing publication or leaking identities', async () => {
      const { review } = await safetyReview();
      const reporter = randomBytes(32).toString('hex');
      const responses = await Promise.all([
        safetyRequest(review.id, 'report', reporter, { reason: 'ABUSE' }),
        safetyRequest(review.id, 'report', reporter, { reason: 'ABUSE' }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({ saved: true });
      }
      expect(
        await prisma.reviewReport.count({ where: { reviewId: review.id } }),
      ).toBe(1);
      expect(
        (
          await prisma.customerReview.findUniqueOrThrow({
            where: { id: review.id },
          })
        ).status,
      ).toBe('PUBLISHED');
      const admin = await fetch(
        `${base}/admin/reviews?reported=true&q=${prefix}`,
        { headers: { authorization: `Bearer ${adminToken}` } },
      );
      expect(admin.status).toBe(200);
      const body = (await admin.json()) as { items: AdminReviewItemDto[] };
      expect(
        body.items.find((item) => item.id === review.id)?.reportCount,
      ).toBe(1);
      expect(JSON.stringify(body)).not.toContain(reviewIdentityHash(reporter));
      expect(JSON.stringify(body)).not.toContain(review.reviewerHash);
    });

    it('isolates blocks, hides the same author across products, and restores only the caller blocks', async () => {
      const { review, identity } = await safetyReview();
      const another = await prisma.product.create({
        data: {
          name: prefix,
          slug: `${prefix}-blocked-author`,
          brandId,
          categoryId,
        },
      });
      const otherReview = await prisma.customerReview.create({
        data: {
          productId: another.id,
          reviewerHash: reviewIdentityHash(identity),
          productRating: 2,
          status: 'PUBLISHED',
        },
      });
      const viewer = randomBytes(32).toString('hex');
      const otherViewer = randomBytes(32).toString('hex');
      const before = await aggregates.productRatings([productId]);
      const blocked = await Promise.all([
        safetyRequest(review.id, 'block', viewer),
        safetyRequest(review.id, 'block', viewer),
      ]);
      expect(blocked.map((response) => response.status)).toEqual([200, 200]);
      expect(
        await prisma.reviewBlock.count({
          where: { blockerHash: reviewIdentityHash(viewer) },
        }),
      ).toBe(1);
      const list = await reviews.list(
        another.slug,
        { page: 1, pageSize: 20 },
        viewer,
      );
      expect(list.total).toBe(0);
      expect(
        (
          await reviews.list(
            another.slug,
            { page: 1, pageSize: 20 },
            otherViewer,
          )
        ).items[0].id,
      ).toBe(otherReview.id);
      expect(
        (await reviews.list(another.slug, { page: 1, pageSize: 20 })).total,
      ).toBe(1);
      expect(await aggregates.productRatings([productId])).toEqual(before);
      await safetyRequest(review.id, 'block', otherViewer);
      expect(
        (
          await fetch(`${base}/reviews/blocks`, {
            method: 'DELETE',
            headers: headers(viewer),
          })
        ).status,
      ).toBe(200);
      expect(
        (await reviews.list(another.slug, { page: 1, pageSize: 20 }, viewer))
          .total,
      ).toBe(1);
      expect(
        (
          await reviews.list(
            another.slug,
            { page: 1, pageSize: 20 },
            otherViewer,
          )
        ).total,
      ).toBe(0);
    });

    it('can hide a legacy review without accidentally blocking every unidentified author', async () => {
      const viewer = randomBytes(32).toString('hex');
      const legacy = await prisma.customerReview.findFirstOrThrow({
        where: { merchantProductId: offerId },
      });
      const second = await prisma.customerReview.create({
        data: {
          merchantProductId: offerId,
          productRating: 4,
          merchantRating: 4,
          status: 'PUBLISHED',
        },
      });
      expect((await safetyRequest(legacy.id, 'block', viewer)).status).toBe(
        200,
      );
      const list = await reviews.list(
        prefix,
        { page: 1, pageSize: 100 },
        viewer,
      );
      expect(list.items.some((item) => item.id === legacy.id)).toBe(false);
      expect(list.items.some((item) => item.id === second.id)).toBe(true);
    });

    it('rejects forged payloads, invalid identities, hidden targets and reporting your own review', async () => {
      const { review, identity } = await safetyReview();
      const viewer = randomBytes(32).toString('hex');
      expect(
        (
          await safetyRequest(review.id, 'report', undefined, {
            reason: 'SPAM',
          })
        ).status,
      ).toBe(401);
      expect((await safetyRequest(review.id, 'block', 'forged')).status).toBe(
        401,
      );
      expect(
        (await safetyRequest(review.id, 'report', identity, { reason: 'SPAM' }))
          .status,
      ).toBe(400);
      expect((await safetyRequest(review.id, 'block', identity)).status).toBe(
        400,
      );
      expect(
        (
          await safetyRequest(review.id, 'report', viewer, {
            reason: 'invalid',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await safetyRequest(review.id, 'report', viewer, {
            reason: 'SPAM',
            reporterHash: review.reviewerHash,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await safetyRequest(review.id, 'block', viewer, {
            blockerHash: review.reviewerHash,
          })
        ).status,
      ).toBe(400);
      expect((await safetyRequest('invalid', 'block', viewer)).status).toBe(
        400,
      );
      expect((await safetyRequest(randomUUID(), 'block', viewer)).status).toBe(
        404,
      );
      expect(
        (
          await fetch(`${base}/products/${prefix}/reviews`, {
            headers: headers('invalid'),
          })
        ).status,
      ).toBe(401);
      expect(
        (await fetch(`${base}/reviews/blocks`, { method: 'DELETE' })).status,
      ).toBe(401);
      await moderate(review.id, 'REJECTED');
      expect(
        (await safetyRequest(review.id, 'report', viewer, { reason: 'SPAM' }))
          .status,
      ).toBe(404);
      expect((await safetyRequest(review.id, 'block', viewer)).status).toBe(
        404,
      );
    });

    it('only admins resolve shown reports; copied review IDs cannot resolve unrelated or later reports', async () => {
      const { review } = await safetyReview();
      await safetyRequest(
        review.id,
        'report',
        randomBytes(32).toString('hex'),
        { reason: 'SPAM' },
      );
      const first = await prisma.reviewReport.findFirstOrThrow({
        where: { reviewId: review.id },
      });
      await safetyRequest(
        review.id,
        'report',
        randomBytes(32).toString('hex'),
        { reason: 'OTHER' },
      );
      const resolve = (id: string, authorization?: string): Promise<Response> =>
        fetch(`${base}/admin/reviews/${id}/reports`, {
          method: 'PATCH',
          headers: {
            ...headers(),
            ...(authorization
              ? { authorization: `Bearer ${authorization}` }
              : {}),
          },
          body: JSON.stringify({ reportIds: [first.id] }),
        });
      expect((await resolve(review.id)).status).toBe(401);
      expect((await resolve(review.id, token)).status).toBe(401);
      expect((await resolve(randomUUID(), adminToken)).status).toBe(200);
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).resolvedAt,
      ).toBeNull();
      expect((await resolve(review.id, adminToken)).status).toBe(200);
      const resolved = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.resolvedBy).toBeTruthy();
      expect(
        await prisma.reviewReport.count({
          where: { reviewId: review.id, resolvedAt: null },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.customerReview.findUniqueOrThrow({
            where: { id: review.id },
          })
        ).status,
      ).toBe('PUBLISHED');
    });

    it('serializes per-identity daily report quotas', async () => {
      const reporter = randomBytes(32).toString('hex');
      const safety = new ReviewSafetyService(prisma, config);
      const targets = await Promise.all(
        Array.from({ length: 21 }, () => safetyReview()),
      );
      const results = await Promise.allSettled(
        targets.map(({ review }) =>
          safety.save(review.id, reporter, { reason: 'SPAM' }),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(20);
      expect(
        await prisma.reviewReport.count({
          where: { reporterHash: reviewIdentityHash(reporter) },
        }),
      ).toBe(20);
      const failed = results.find((result) => result.status === 'rejected');
      expect(
        failed?.status === 'rejected' &&
          (failed.reason as { getStatus(): number }).getStatus(),
      ).toBe(429);
    });

    it('bounds blocks and rate limits safety writes over HTTP', async () => {
      const viewer = randomBytes(32).toString('hex');
      const ids = Array.from({ length: 500 }, () => randomUUID());
      await prisma.customerReview.createMany({
        data: ids.map((id) => ({
          id,
          merchantProductId: offerId,
          productRating: 4,
          merchantRating: 4,
          status: 'PUBLISHED' as const,
        })),
      });
      await prisma.reviewBlock.createMany({
        data: ids.map((reviewId) => ({
          reviewId,
          blockerHash: reviewIdentityHash(viewer),
        })),
      });
      const { review } = await safetyReview();
      expect((await safetyRequest(review.id, 'block', viewer)).status).toBe(
        429,
      );
      expect((await safetyRequest(ids[0], 'block', viewer)).status).toBe(200);
      const otherViewer = randomBytes(32).toString('hex');
      limiter.storage.clear();
      for (let i = 0; i < 20; i++)
        expect(
          (await safetyRequest(review.id, 'block', otherViewer)).status,
        ).toBe(200);
      expect(
        (await safetyRequest(review.id, 'block', otherViewer)).status,
      ).toBe(429);
      await prisma.customerReview.deleteMany({
        where: { id: { in: ids }, merchantProductId: offerId },
      });
    });

    const accessRequest = (
      id: string,
      body: unknown,
      authorization: string | null = adminToken,
    ): Promise<Response> =>
      fetch(`${base}/admin/reviews/${id}/reviewer-access`, {
        method: 'PATCH',
        headers: {
          ...headers(),
          ...(authorization
            ? { authorization: `Bearer ${authorization}` }
            : {}),
        },
        body: JSON.stringify(body),
      });
    const access = (
      id: string,
      banned: boolean,
      expectedRevision: string | null = null,
    ): Promise<Response> =>
      accessRequest(id, { banned, confirmed: true, expectedRevision });

    it('filters new comments before persistence without censoring negative ratings', async () => {
      const identity = randomBytes(32).toString('hex');
      expect(
        (await submit(identity, { rating: 1, comment: 'Vou te matar' })).status,
      ).toBe(422);
      expect(
        await prisma.customerReview.count({
          where: { reviewerHash: reviewIdentityHash(identity) },
        }),
      ).toBe(0);
      expect(
        (
          await submit(identity, {
            rating: 1,
            comment: 'Produto péssimo, não recomendo.',
          })
        ).status,
      ).toBe(200);
      // An old hidden comment cannot bypass the filter through manual publish.
      const legacy = await prisma.customerReview.create({
        data: {
          merchantProductId: offerId,
          productRating: 1,
          merchantRating: 1,
          comment: 'fuck you',
          status: 'REJECTED',
        },
      });
      expect((await moderate(legacy.id, 'PUBLISHED')).status).toBe(422);
      expect(
        (
          await prisma.customerReview.findUniqueOrThrow({
            where: { id: legacy.id },
          })
        ).status,
      ).toBe('REJECTED');
    });

    it('only admins can ban a resolved author, with explicit confirmation and a complete revision', async () => {
      const { review, identity } = await safetyReview();
      banHashes.push(reviewIdentityHash(identity));
      const body = { banned: true, confirmed: true, expectedRevision: null };
      expect((await accessRequest(review.id, body, null)).status).toBe(401);
      expect((await accessRequest(review.id, body, identity)).status).toBe(401);
      for (const invalid of [
        { ...body, reviewerHash: review.reviewerHash },
        { ...body, confirmed: false },
        { banned: true, confirmed: true },
        { ...body, expectedRevision: 'forged' },
        { ...body, banned: 'true' },
      ])
        expect((await accessRequest(review.id, invalid)).status).toBe(400);
      expect((await access(randomUUID(), true)).status).toBe(404);
      const legacy = await prisma.customerReview.findFirstOrThrow({
        where: { merchantProductId: offerId },
      });
      expect((await access(legacy.id, true)).status).toBe(400);
      expect(
        await prisma.reviewerBan.count({
          where: { reviewerHash: reviewIdentityHash(identity) },
        }),
      ).toBe(0);
    });

    it('ban hides all author reviews, blocks writes, and unban does not republish or accept stale decisions', async () => {
      const { review, identity } = await safetyReview();
      const hash = reviewIdentityHash(identity);
      banHashes.push(hash);
      const another = await prisma.product.create({
        data: { name: prefix, slug: `${prefix}-ban`, brandId, categoryId },
      });
      expect((await submit(identity, { rating: 2 }, another.slug)).status).toBe(
        200,
      );
      const before = await aggregates.productRatings([another.id]);
      expect(before.get(another.id)?.count).toBe(1);
      expect((await access(review.id, true)).status).toBe(200);
      expect(
        await prisma.customerReview.count({
          where: { reviewerHash: hash, status: 'PUBLISHED' },
        }),
      ).toBe(0);
      expect(
        (await aggregates.productRatings([another.id])).has(another.id),
      ).toBe(false);
      expect((await submit(identity, { rating: 2 }, another.slug)).status).toBe(
        403,
      ); // identical retry
      expect((await moderate(review.id, 'PUBLISHED')).status).toBe(409);
      const third = await prisma.product.create({
        data: { name: prefix, slug: `${prefix}-unban`, brandId, categoryId },
      });
      expect((await submit(identity, { rating: 3 }, third.slug)).status).toBe(
        403,
      );
      expect(
        (
          await submit(
            randomBytes(32).toString('hex'),
            { rating: 3 },
            third.slug,
          )
        ).status,
      ).toBe(200);
      const list = await aggregates.adminList({
        page: 1,
        pageSize: 100,
        q: prefix,
      });
      expect(JSON.stringify(list)).not.toContain(hash);
      expect(JSON.stringify(list)).not.toContain(identity);
      const state = list.items.find(
        (item) => item.id === review.id,
      )?.reviewerAccess;
      expect(state?.banned).toBe(true);
      expect(state?.revision).toBeTruthy();
      expect((await access(review.id, false)).status).toBe(409);
      expect((await access(review.id, false, state!.revision)).status).toBe(
        200,
      );
      expect((await access(review.id, true, state!.revision)).status).toBe(409);
      expect(
        await prisma.customerReview.count({
          where: { reviewerHash: hash, status: 'PUBLISHED' },
        }),
      ).toBe(0);
      expect((await submit(identity, { rating: 4 }, third.slug)).status).toBe(
        200,
      );
      const ban = await prisma.reviewerBan.findUniqueOrThrow({
        where: { reviewerHash: hash },
      });
      expect(ban.active).toBe(false);
      expect(ban.updatedBy).toBeTruthy();
    });

    it('serializes bans against concurrent new submissions and publishing', async () => {
      const { review, identity } = await safetyReview();
      const hash = reviewIdentityHash(identity);
      banHashes.push(hash);
      const another = await prisma.product.create({
        data: { name: prefix, slug: `${prefix}-ban-race`, brandId, categoryId },
      });
      const [ban, submitted, published] = await Promise.all([
        access(review.id, true),
        submit(identity, { rating: 3 }, another.slug),
        moderate(review.id, 'PUBLISHED'),
      ]);
      expect(ban.status).toBe(200);
      expect([200, 403]).toContain(submitted.status);
      expect([200, 409]).toContain(published.status);
      expect(
        await prisma.customerReview.count({
          where: { reviewerHash: hash, status: 'PUBLISHED' },
        }),
      ).toBe(0);
      const current = await prisma.reviewerBan.findUniqueOrThrow({
        where: { reviewerHash: hash },
      });
      const concurrent = await Promise.all([
        access(review.id, false, current.revision),
        access(review.id, true, current.revision),
      ]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
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
      expect((await safetyRequest(randomUUID(), 'block', token)).status).toBe(
        404,
      );
      expect(
        (await safetyRequest(randomUUID(), 'report', token, { reason: 'SPAM' }))
          .status,
      ).toBe(404);
      expect(
        (
          await fetch(`${base}/reviews/blocks`, {
            method: 'DELETE',
            headers: headers(token),
          })
        ).status,
      ).toBe(404);
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
