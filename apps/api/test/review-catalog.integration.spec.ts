import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { FreshnessService } from '../src/common/freshness/freshness.service';
import { REVIEW_MERCHANT_ID } from '../src/common/public-catalog';
import { MerchantsService } from '../src/merchants/merchants.service';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import { MerchantAccessService } from '../src/merchant-access/merchant-access.service';
import { PasswordService } from '../src/merchant-access/password.service';
import { ProductsService } from '../src/products/products.service';
import { ProductListQueryDto } from '../src/products/products.dto';
import { CategoriesService } from '../src/categories/categories.service';
import { CommercialService } from '../src/commercial/commercial.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import { ProductReviewsService } from '../src/reviews/product-reviews.service';
import { SearchAnalyticsService } from '../src/analytics/search-analytics.service';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a disposable localhost test database is allowed.');
const run = url ? describe : describe.skip;
const prefix = `visibility-${randomUUID().slice(0, 8)}`;
run(
  'review workspace is private without changing merchant authorization',
  () => {
    let module: Awaited<
      ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
    >;
    let db: PrismaService;
    let merchants: MerchantsService;
    let products: ProductsService;
    let offers: MerchantOffersService;
    let realId: string,
      categoryId: string,
      brandId: string,
      demoProductId: string,
      sharedProductId: string;
    const password = randomBytes(24).toString('base64url');
    const config = new ConfigService({
      DATABASE_URL: url,
      MERCHANT_ACCESS_ENABLED: true,
      PRODUCT_REVIEWS_ENABLED: true,
      IMPORT_SUPPORTED_CURRENCIES: 'BRL',
    });
    beforeAll(async () => {
      module = await Test.createTestingModule({
        providers: [
          { provide: ConfigService, useValue: config },
          PrismaService,
          FreshnessService,
          ReviewsService,
          MerchantsService,
          ProductsService,
          MerchantOffersService,
          MerchantAccessService,
          PasswordService,
          CategoriesService,
          CommercialService,
          ProductReviewsService,
          SearchAnalyticsService,
        ],
      }).compile();
      db = module.get(PrismaService);
      await db.$connect();
      merchants = module.get(MerchantsService);
      products = module.get(ProductsService);
      offers = module.get(MerchantOffersService);
      await db.merchant.create({
        data: {
          id: REVIEW_MERCHANT_ID,
          name: 'Review workspace',
          slug: `${prefix}-review`,
          sponsored: true,
        },
      });
      realId = (
        await db.merchant.create({
          data: { name: 'Real store', slug: `${prefix}-real`, sponsored: true },
        })
      ).id;
      categoryId = (
        await db.category.create({ data: { name: prefix, slug: prefix } })
      ).id;
      brandId = (
        await db.brand.create({ data: { name: prefix, slug: prefix } })
      ).id;
    const make = async (suffix: string): Promise<string> =>
        (
          await db.product.create({
            data: {
              name: `${prefix} ${suffix}`,
              slug: `${prefix}-${suffix}`,
              brandId,
              categoryId,
            },
          })
        ).id;
      demoProductId = await make('private');
      sharedProductId = await make('shared');
      for (const [merchantId, productId, price] of [
        [REVIEW_MERCHANT_ID, demoProductId, '1'],
        [REVIEW_MERCHANT_ID, sharedProductId, '2'],
        [realId, sharedProductId, '100'],
      ]) {
        const offer = await db.merchantProduct.create({
          data: {
            merchantId,
            productId,
            merchantSku: productId,
            price,
            currency: 'BRL',
            availability: 'IN_STOCK',
            sourceUpdatedAt: new Date(),
            sponsored: true,
            promotionText: 'Offer',
          },
        });
        await db.priceHistory.create({
          data: {
            merchantProductId: offer.id,
            newPrice: price,
            currency: 'BRL',
            source: 'MANUAL',
          },
        });
      }
      await module
        .get(MerchantAccessService)
        .provision(
          REVIEW_MERCHANT_ID,
          { username: prefix, password },
          'test:visibility',
        );
    });
    afterAll(async () => {
      if (db) {
        await db.searchEvent.deleteMany({
          where: { query: { contains: prefix } },
        });
        await db.priceHistory.deleteMany({
          where: {
            merchantProduct: {
              merchantId: { in: [REVIEW_MERCHANT_ID, realId] },
            },
          },
        });
        await db.merchantProduct.deleteMany({
          where: { merchantId: { in: [REVIEW_MERCHANT_ID, realId] } },
        });
        await db.product.deleteMany({ where: { brandId } });
        await db.merchantUser.deleteMany({
          where: { merchantId: REVIEW_MERCHANT_ID },
        });
        await db.merchant.deleteMany({
          where: { id: { in: [REVIEW_MERCHANT_ID, realId] } },
        });
        await db.category.delete({ where: { id: categoryId } });
        await db.brand.delete({ where: { id: brandId } });
      }
      await module?.close();
    });
    it('hides the review store publicly but retains admin visibility', async () => {
      const result = await merchants.list({ page: 1, pageSize: 100 });
      expect(result.items.some((item) => item.id === REVIEW_MERCHANT_ID)).toBe(
        false,
      );
      expect(result.items.some((item) => item.id === realId)).toBe(true);
      await expect(merchants.detail(`${prefix}-review`)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        merchants.offers(`${prefix}-review`, {
          page: 1,
          pageSize: 20,
          includeUnpriced: true,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await merchants.adminList({ page: 1, pageSize: 100 })).items.some(
          (item) => item.id === REVIEW_MERCHANT_ID,
        ),
      ).toBe(true);
    });
    it('excludes test-only products and demo offers from listing, search, detail and history', async () => {
      const context = {
        platform: 'IOS' as const,
        clientVersion: 'test',
        anonymousIdHash: null,
        ipHash: null,
      };
      for (const q of [undefined, prefix]) {
        const list = await products.list(
          Object.assign(new ProductListQueryDto(), { q, pageSize: 100 }),
          context,
        );
        expect(list.items.some((item) => item.id === demoProductId)).toBe(
          false,
        );
        const shared = list.items.find((item) => item.id === sharedProductId);
        expect(shared?.merchantCount).toBe(1);
        expect(shared?.bestPrice?.amount).toBe('100');
      }
      await expect(
        products.detail(`${prefix}-private`, true),
      ).rejects.toMatchObject({ status: 404 });
      const detail = await products.detail(`${prefix}-shared`, true);
      expect(detail.offers.map((offer) => offer.merchant.id)).toEqual([realId]);
      const history = await products.priceHistory(`${prefix}-shared`, {
        page: 1,
        pageSize: 100,
        days: 30,
      });
      expect(history.items.map((item) => item.merchant.id)).toEqual([realId]);
      expect(
        (
          await module.get(CategoriesService).list({ page: 1, pageSize: 100 })
        ).items.find((item) => item.id === categoryId)?.productCount,
      ).toBe(1);
    });
    it('hides sponsored demo records and public reviews of test-only products', async () => {
      const commercial = module.get(CommercialService);
      const highlights = await commercial.highlights();
      expect(
        highlights.merchants.some((item) => item.id === REVIEW_MERCHANT_ID),
      ).toBe(false);
      expect(
        highlights.offers.every(
          (item) => item.merchant.id !== REVIEW_MERCHANT_ID,
        ),
      ).toBe(true);
      expect(
        (await commercial.promotions({ page: 1, pageSize: 100 })).items.every(
          (item) => item.merchant.id !== REVIEW_MERCHANT_ID,
        ),
      ).toBe(true);
      const reviews = module.get(ProductReviewsService);
      await expect(
        reviews.list(`${prefix}-private`, { page: 1, pageSize: 20 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        reviews.create(`${prefix}-private`, 'a'.repeat(64), { rating: 5 }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it('still permits reviewer login and manual create, duplicate detection, removal and restoration', async () => {
      const access = module.get(MerchantAccessService);
      const login = await access.login({ username: prefix, password });
      expect(login.merchant.id).toBe(REVIEW_MERCHANT_ID);
      const actor = await access.authenticate(login.token);
      const input = {
        newProduct: { name: `${prefix} added`, brand: prefix, categoryId },
        merchantSku: '987654321',
        price: '',
        priceOnRequest: true,
        currency: 'BRL',
        availability: 'IN_STOCK' as const,
        stock: '5',
        confirmed: true,
        confirmWarnings: true,
      };
      const added = await offers.create(
        REVIEW_MERCHANT_ID,
        input,
        'test:review',
        actor,
      );
      await expect(
        offers.create(
          REVIEW_MERCHANT_ID,
          { ...input, merchantSku: 'other' },
          'test:review',
          actor,
        ),
      ).rejects.toThrow('already exist');
      const removed = await offers.remove(
        REVIEW_MERCHANT_ID,
        added.id,
        { confirmed: true, expectedUpdatedAt: added.updatedAt },
        'test:review',
        actor,
      );
      expect(removed.active).toBe(false);
      await expect(
        products.detail(added.product.slug, true),
      ).rejects.toMatchObject({ status: 404 });
      const restored = await offers.update(
        REVIEW_MERCHANT_ID,
        added.id,
        { ...input, expectedUpdatedAt: removed.updatedAt, active: true },
        'test:review',
        actor,
      );
      expect(restored.active).toBe(true);
    });
  },
);
