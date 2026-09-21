import 'reflect-metadata';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { CommercialService } from '../src/commercial/commercial.service';
import { MerchantAccessService } from '../src/merchant-access/merchant-access.service';
import { PasswordService } from '../src/merchant-access/password.service';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import { ImportStagingService } from '../src/imports/import-staging.service';
import { ImportCommitService } from '../src/imports/import-commit.service';
import { ImportsService } from '../src/imports/imports.service';
import {
  ProductListQueryDto,
  type ProductDetailDto,
} from '../src/products/products.dto';
import type { MerchantOfferListResponseDto } from '../src/merchants/merchants.dto';
import { searchCatalog } from '../src/products/catalog-search';
import { effectivePrice } from '../src/commercial/offer-pricing';
import type {
  AdminOfferDto,
  UpdateMerchantOfferDto,
} from '../src/merchants/merchant-offers.dto';
import type { CommercialChangeDto } from '../src/commercial/commercial.dto';
import type { MerchantLoginResponseDto } from '../src/merchant-access/merchant-access.dto';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a disposable localhost test database is allowed.');
const run = url ? describe : describe.skip;
const require = createRequire(
  `${process.cwd()}/test/commercial.integration.spec.ts`,
);
const prefix = `commercial-${randomUUID().slice(0, 8)}`;
run('commercial offers, sponsorship and fuzzy discovery', () => {
  let prisma: PrismaService,
    commercial: CommercialService,
    offers: MerchantOffersService,
    app: INestApplication;
  let base: string,
    merchantId: string,
    otherId: string,
    productId: string,
    categoryId: string,
    brandId: string;
  let offer: AdminOfferDto, session: MerchantLoginResponseDto;
  const adminToken = randomBytes(32).toString('base64url');
  const config = new ConfigService({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    MERCHANT_ACCESS_ENABLED: true,
    PHOTO_IMPORT_ENABLED: false,
    IMPORT_SUPPORTED_CURRENCIES: 'BRL,USD,PYG',
    ADMIN_AUTH_MODE: 'firebase',
    FIREBASE_PROJECT_ID: 'achaaqui-web',
  });
  beforeAll(async () => {
    prisma = new PrismaService(config);
    await prisma.$connect();
    commercial = new CommercialService(prisma);
    offers = new MerchantOffersService(prisma, config);
    categoryId = (
      await prisma.category.create({ data: { name: prefix, slug: prefix } })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: 'Apple', slug: prefix } })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          name: 'iPhone 15 128GB',
          model: 'A3090',
          slug: prefix,
          categoryId,
          brandId,
        },
      })
    ).id;
    merchantId = (
      await prisma.merchant.create({ data: { name: prefix, slug: prefix } })
    ).id;
    otherId = (
      await prisma.merchant.create({
        data: { name: prefix, slug: `${prefix}-other` },
      })
    ).id;
    const access = new MerchantAccessService(
      prisma,
      new PasswordService(),
      config,
    );
    const password = randomBytes(24).toString('base64url');
    await access.provision(
      merchantId,
      { username: prefix, password },
      'firebase:test',
    );
    const { AppModule } =
      require('../dist/app.module.js') as typeof import('../src/app.module');
    const { PrismaService: CompiledPrisma } =
      require('../dist/database/prisma.service.js') as typeof import('../src/database/prisma.service');
    const { FirebaseAdminAuthService } =
      require('../dist/admin-auth/firebase-admin-auth.service.js') as typeof import('../src/admin-auth/firebase-admin-auth.service');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(CompiledPrisma)
      .useValue(prisma)
      .overrideProvider(FirebaseAdminAuthService)
      .useValue({
        verify: (token: string) => {
          if (token === adminToken)
            return { id: 'firebase:test', role: 'platform_admin' };
          throw new UnauthorizedException();
        },
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
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
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1`;
    const login = await call('/merchant/auth/login', 'POST', {
      username: prefix,
      password,
    });
    expect(login.status).toBe(200);
    session = (await login.json()) as MerchantLoginResponseDto;
  }, 20000);
  beforeEach(async () => {
    await prisma.priceHistory.deleteMany({
      where: { merchantProduct: { merchantId: { in: [merchantId, otherId] } } },
    });
    await prisma.import.deleteMany({ where: { merchantId } });
    await prisma.merchantProduct.deleteMany({
      where: { merchantId: { in: [merchantId, otherId] } },
    });
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { active: true, sponsored: false },
    });
    offer = await offers.create(
      merchantId,
      {
        productId,
        merchantSku: 'SKU',
        price: '100',
        currency: 'BRL',
        stock: '5',
        availability: 'IN_STOCK',
        confirmed: true,
        confirmWarnings: false,
      },
      'firebase:test',
    );
  });
  afterAll(async () => {
    await app?.close();
    if (!prisma) return;
    await prisma.$connect();
    await prisma.merchantUser.deleteMany({
      where: { merchantId: { in: [merchantId, otherId] } },
    });
    await prisma.priceHistory.deleteMany({
      where: { merchantProduct: { merchantId: { in: [merchantId, otherId] } } },
    });
    await prisma.import.deleteMany({ where: { merchantId } });
    await prisma.merchantProduct.deleteMany({
      where: { merchantId: { in: [merchantId, otherId] } },
    });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantId, otherId] } },
    });
    await prisma.brand.delete({ where: { id: brandId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    token?: string,
  ): Promise<Response> {
    return await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function input(
    overrides: Partial<CommercialChangeDto> = {},
  ): CommercialChangeDto {
    return {
      expectedUpdatedAt: offer.updatedAt,
      confirmed: true,
      salePrice: '80,00',
      saleEndsAt: null,
      promotionText: 'Leve 2, pague 1',
      promotionEndsAt: null,
      ...overrides,
    };
  }
  it('requires auth, scopes copied IDs and rejects client merchant or sponsorship fields', async () => {
    expect(
      (await call(`/merchant/offers/${offer.id}/commercial`, 'PATCH', input()))
        .status,
    ).toBe(401);
    const foreign = await offers.create(otherId, {
      productId,
      merchantSku: 'B',
      price: '100',
      currency: 'BRL',
      stock: '1',
      availability: 'IN_STOCK',
      confirmed: true,
      confirmWarnings: false,
    });
    expect(
      (
        await call(
          `/merchant/offers/${foreign.id}/commercial`,
          'PATCH',
          input(),
          session.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          `/merchant/offers/${offer.id}/commercial`,
          'PATCH',
          { ...input(), merchantId: otherId },
          session.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          `/merchant/offers/${offer.id}/commercial`,
          'PATCH',
          { ...input(), sponsored: true },
          session.token,
        )
      ).status,
    ).toBe(400);
    for (const path of [
      `/admin/merchants/${merchantId}/highlight`,
      `/admin/merchants/${merchantId}/offers/${offer.id}/highlight`,
      `/admin/merchants/${merchantId}/offers/${offer.id}/commercial`,
    ])
      expect(
        (
          await call(
            path,
            'PATCH',
            { sponsored: true, expectedUpdatedAt: offer.updatedAt },
            session.token,
          )
        ).status,
      ).toBe(401);
  });
  it('requires confirmation and all fields; validates price and expiry', async () => {
    for (const payload of [
      input({ confirmed: false }),
      input({ salePrice: '100' }),
      input({ salePrice: '0' }),
      input({ salePrice: '-2' }),
      input({ saleEndsAt: '2000-01-01T00:00:00Z' }),
      input({ salePrice: null, saleEndsAt: '2099-01-01T00:00:00Z' }),
      { expectedUpdatedAt: offer.updatedAt, confirmed: true },
    ])
      expect(
        (
          await call(
            `/merchant/offers/${offer.id}/commercial`,
            'PATCH',
            payload,
            session.token,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await prisma.merchantProduct.findUniqueOrThrow({
          where: { id: offer.id },
        })
      ).salePrice,
    ).toBeNull();
  });
  it('publishes effective prices without exposing internal credentials, SKU, stock or actors', async () => {
    expect(
      (
        await call(
          `/merchant/offers/${offer.id}/commercial`,
          'PATCH',
          input(),
          session.token,
        )
      ).status,
    ).toBe(200);
    const detail = (await (
      await call(`/products/${prefix}`)
    ).json()) as ProductDetailDto;
    expect(Number(detail.bestPrice?.amount)).toBe(80);
    expect(detail.offers[0].regularPrice?.amount).toBe('100');
    expect(detail.offers[0].promotion?.text).toBe('Leve 2, pague 1');
    const publicList = (await (await call('/promotions')).json()) as Awaited<
      ReturnType<CommercialService['promotions']>
    >;
    const item = publicList.items.find(
      (row: { id: string }) => row.id === offer.id,
    );
    expect(item).toBeDefined();
    expect(JSON.stringify(item)).not.toMatch(
      /merchantSku|stockQuantity|commercialUpdatedBy|highlightedBy|password|token/,
    );
    const history = await prisma.priceHistory.findMany({
      where: { merchantProductId: offer.id },
      orderBy: { changedAt: 'desc' },
    });
    expect(history[0].oldPrice?.toString()).toBe('100');
    expect(history[0].newPrice.toString()).toBe('80');
  });
  it('rejects concurrent and stale confirmations without duplicate history', async () => {
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        call(
          `/merchant/offers/${offer.id}/commercial`,
          'PATCH',
          input(),
          session.token,
        ),
      ),
    );
    expect(outcomes.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.priceHistory.count({
        where: { merchantProductId: offer.id },
      }),
    ).toBe(2);
  });
  it('does not republish a removed offer and hides it from promotions', async () => {
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: { active: false, updatedAt: new Date(offer.updatedAt) },
    });
    await commercial.update(merchantId, offer.id, input(), 'firebase:test');
    expect(
      (
        await prisma.merchantProduct.findUniqueOrThrow({
          where: { id: offer.id },
        })
      ).active,
    ).toBe(false);
    expect(
      (await commercial.promotions({ page: 1, pageSize: 100 })).items.some(
        (item) => item.id === offer.id,
      ),
    ).toBe(false);
  });
  it('expires sale and promotion at read time, including sorting before pagination; no synthetic history', async () => {
    await commercial.update(merchantId, offer.id, input(), 'firebase:test');
    const second = await prisma.product.create({
      data: {
        name: prefix,
        slug: `${prefix}-${randomUUID()}`,
        categoryId,
        brandId,
      },
    });
    const secondOffer = await offers.create(merchantId, {
      productId: second.id,
      merchantSku: 'TWO',
      price: '90',
      currency: 'BRL',
      stock: '1',
      availability: 'IN_STOCK',
      confirmed: true,
      confirmWarnings: false,
    });
    let listing = (await (
      await call(`/merchants/${prefix}/offers?pageSize=1`)
    ).json()) as MerchantOfferListResponseDto;
    expect(listing.items[0].id).toBe(offer.id);
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: { saleEndsAt: new Date(0), promotionEndsAt: new Date(0) },
    });
    listing = (await (
      await call(`/merchants/${prefix}/offers?pageSize=1`)
    ).json()) as MerchantOfferListResponseDto;
    expect(listing.items[0].id).toBe(secondOffer.id);
    const detail = (await (
      await call(`/products/${prefix}`)
    ).json()) as ProductDetailDto;
    expect(Number(detail.bestPrice?.amount)).toBe(100);
    expect(detail.offers[0].regularPrice).toBeNull();
    expect(detail.offers[0].promotion).toBeNull();
    expect(
      (await commercial.promotions({ page: 1, pageSize: 100 })).items.some(
        (item) => item.id === offer.id,
      ),
    ).toBe(false);
    expect(
      await prisma.priceHistory.count({
        where: { merchantProductId: offer.id },
      }),
    ).toBe(2);
  });
  it('stock-only changes preserve discounts; regular-price changes clear them and record the effective old price', async () => {
    await commercial.update(merchantId, offer.id, input(), 'firebase:test');
    let current = await offers.detail(merchantId, offer.id);
    const edit = (): UpdateMerchantOfferDto => ({
      merchantSku: current.merchantSku,
      price: current.price.amount,
      currency: current.price.currency,
      stock: '6',
      availability: current.availability,
      active: current.active,
      expectedUpdatedAt: current.updatedAt,
      confirmed: true as const,
      confirmWarnings: true,
    });
    current = await offers.update(
      merchantId,
      offer.id,
      edit(),
      'firebase:test',
    );
    expect(current.salePrice).toBe('80');
    current = await offers.update(
      merchantId,
      offer.id,
      { ...edit(), price: '95' },
      'firebase:test',
    );
    expect(current.salePrice).toBeNull();
    const history = await prisma.priceHistory.findFirstOrThrow({
      where: { merchantProductId: offer.id },
      orderBy: { changedAt: 'desc' },
    });
    expect(history.oldPrice?.toString()).toBe('80');
    expect(history.newPrice.toString()).toBe('95');
  });
  it('CSV stock changes preserve the sale; imported price changes end it with effective-price history', async () => {
    await commercial.update(merchantId, offer.id, input(), 'firebase:test');
    const staging = new ImportStagingService(prisma, config);
    const imports = new ImportsService(prisma);
    const commit = new ImportCommitService(prisma);
    for (const price of ['100', '95']) {
      const buffer = Buffer.from(
        `merchantSku,productName,price,currency,stock,availability\nSKU,iPhone,${price},BRL,6,TRUE`,
      );
      const id = await staging.stageCsv(
        { merchantId },
        {
          buffer,
          originalname: 'prices.csv',
          size: buffer.length,
          mimetype: 'text/csv',
        },
      );
      const preview = await imports.detail(id);
      await commit.commit(id, {
        confirmWarnings: true,
        expectedPreviewToken: preview.previewToken,
      });
      const current = await prisma.merchantProduct.findUniqueOrThrow({
        where: { id: offer.id },
      });
      expect(current.salePrice?.toString() ?? null).toBe(
        price === '100' ? '80' : null,
      );
    }
    const history = await prisma.priceHistory.findFirstOrThrow({
      where: { merchantProductId: offer.id },
      orderBy: { changedAt: 'desc' },
    });
    expect(history.oldPrice?.toString()).toBe('80');
    expect(history.newPrice.toString()).toBe('95');
  });

  it('invalidates a previously staged import after a commercial edit', async () => {
    const buffer = Buffer.from(
      'merchantSku,productName,price,currency\nSKU,iPhone,99,BRL',
    );
    const staged = await new ImportStagingService(prisma, config).stageCsv(
      { merchantId },
      {
        buffer,
        originalname: 'prices.csv',
        size: buffer.length,
        mimetype: 'text/csv',
      },
    );
    await commercial.update(merchantId, offer.id, input(), 'firebase:test');
    const detail = await new ImportsService(prisma).detail(staged);
    await expect(
      new ImportCommitService(prisma).commit(
        staged,
        {
          confirmWarnings: true,
          confirmNewProducts: false,
          expectedPreviewToken: detail.previewToken,
        },
        'firebase:test',
      ),
    ).rejects.toThrow();
    expect(
      effectivePrice(
        await prisma.merchantProduct.findUniqueOrThrow({
          where: { id: offer.id },
        }),
      ).toString(),
    ).toBe('80');
  });
  it('only admins can sponsor, and inactive or unavailable records disappear', async () => {
    const merchant = await commercial.merchantHighlight(merchantId);
    expect(
      (
        await call(
          `/admin/merchants/${merchantId}/highlight`,
          'PATCH',
          { expectedUpdatedAt: merchant.updatedAt, sponsored: true },
          adminToken,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await call(
          `/admin/merchants/${merchantId}/offers/${offer.id}/highlight`,
          'PATCH',
          { expectedUpdatedAt: offer.updatedAt, sponsored: true },
          adminToken,
        )
      ).status,
    ).toBe(204);
    let highlights = await commercial.highlights();
    expect(highlights.offers.some((item) => item.id === offer.id)).toBe(true);
    expect(highlights.merchants.some((item) => item.id === merchantId)).toBe(
      true,
    );
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: { availability: 'OUT_OF_STOCK', stockQuantity: 0 },
    });
    highlights = await commercial.highlights();
    expect(highlights.offers.some((item) => item.id === offer.id)).toBe(false);
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { active: false },
    });
    highlights = await commercial.highlights();
    expect(highlights.merchants.some((item) => item.id === merchantId)).toBe(
      false,
    );
  });
  it('allows unchanged expired discounts while editing a promotion, but rejects fractional PYG prices', async () => {
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: {
        salePrice: '80',
        saleEndsAt: new Date(0),
        updatedAt: new Date(offer.updatedAt),
      },
    });
    await commercial.update(
      merchantId,
      offer.id,
      input({ saleEndsAt: new Date(0).toISOString() }),
      'firebase:test',
    );
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: { currency: 'PYG' },
    });
    const current = await offers.detail(merchantId, offer.id);
    await expect(
      commercial.update(
        merchantId,
        offer.id,
        input({ expectedUpdatedAt: current.updatedAt, salePrice: '80.50' }),
        'firebase:test',
      ),
    ).rejects.toThrow();
  });

  it('finds typos, spacing, accents and reordered tokens without fuzzy numeric variants or sponsored ranking', async () => {
    for (const q of ['iphnoe', 'iphone15', '128 GB Apple 15', 'a3090'])
      expect(
        (
          await searchCatalog(prisma, {
            ...new ProductListQueryDto(),
            q,
            categorySlug: prefix,
          })
        ).ids,
      ).toContain(productId);
    expect(
      (
        await searchCatalog(prisma, {
          ...new ProductListQueryDto(),
          q: 'iphone16',
          categorySlug: prefix,
        })
      ).ids,
    ).not.toContain(productId);
    expect(
      (
        await searchCatalog(prisma, {
          ...new ProductListQueryDto(),
          q: 'iphone',
          merchantSlug: `${prefix}-other`,
        })
      ).ids,
    ).not.toContain(productId);
    await prisma.product.update({
      where: { id: productId },
      data: { model: 'Edição Única' },
    });
    expect(
      (
        await searchCatalog(prisma, {
          ...new ProductListQueryDto(),
          q: 'edicao unica',
          categorySlug: prefix,
        })
      ).ids,
    ).toContain(productId);
    await prisma.brand.update({
      where: { id: brandId },
      data: { name: 'Novamarca' },
    });
    expect(
      (
        await searchCatalog(prisma, {
          ...new ProductListQueryDto(),
          q: 'novamarca',
          categorySlug: prefix,
        })
      ).ids,
    ).toContain(productId);
    const first = await searchCatalog(prisma, {
      ...new ProductListQueryDto(),
      q: 'iphone',
      categorySlug: prefix,
    });
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: { sponsored: true },
    });
    expect(
      await searchCatalog(prisma, {
        ...new ProductListQueryDto(),
        q: 'iphone',
        categorySlug: prefix,
      }),
    ).toEqual(first);
  });

  it('rechecks revocation inside the commercial write, even after a previously valid authentication', async () => {
    const access = new MerchantAccessService(
      prisma,
      new PasswordService(),
      config,
    );
    const actor = await access.authenticate(session.token);
    await access.logout(actor);
    await expect(
      commercial.update(
        merchantId,
        offer.id,
        input(),
        `merchant:${actor.userId}`,
        actor,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      (
        await call(
          `/merchant/offers/${offer.id}/commercial`,
          'PATCH',
          input(),
          session.token,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await prisma.merchantProduct.findUniqueOrThrow({
          where: { id: offer.id },
        })
      ).salePrice,
    ).toBeNull();
  });
});
