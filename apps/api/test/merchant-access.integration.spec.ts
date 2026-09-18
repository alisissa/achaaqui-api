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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import {
  MerchantAccessService,
  hashSessionToken,
} from '../src/merchant-access/merchant-access.service';
import { PasswordService } from '../src/merchant-access/password.service';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { MerchantLoginResponseDto } from '../src/merchant-access/merchant-access.dto';
import type {
  AdminOfferDto,
  AdminOfferListDto,
  CreateMerchantOfferDto,
} from '../src/merchants/merchant-offers.dto';
import type { MerchantSessionDto } from '../src/merchant-access/merchant-access.dto';

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;
// Fail closed even when somebody mistakenly supplies a real connection string.
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error(
    'Merchant HTTP tests require an explicit localhost test database.',
  );
const require = createRequire(
  `${process.cwd()}/test/merchant-access.integration.spec.ts`,
);
const prefix = `access-${randomUUID().slice(0, 8)}`;

run('merchant HTTP access and transaction isolation', () => {
  let prisma: PrismaService;
  let access: MerchantAccessService;
  let offers: MerchantOffersService;
  let app: INestApplication;
  let base: string;
  let a: string;
  let b: string;
  let fresh: string;
  let productId: string;
  let categoryId: string;
  let other: AdminOfferDto;
  let session: MerchantLoginResponseDto;
  const password = randomBytes(24).toString('base64url');
  const adminToken = randomBytes(32).toString('base64url');
  const config = new ConfigService({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    MERCHANT_ACCESS_ENABLED: true,
    IMPORT_SUPPORTED_CURRENCIES: 'BRL,USD,PYG',
    ADMIN_AUTH_MODE: 'firebase',
    FIREBASE_PROJECT_ID: 'achaaqui-web',
  });
  const input = (): CreateMerchantOfferDto => ({
    merchantSku: 'PRIVATE-SKU-A',
    price: '100.00',
    currency: 'BRL',
    stock: '23',
    availability: 'IN_STOCK' as const,
    confirmed: true,
    confirmWarnings: false,
    productId,
  });

  beforeAll(async () => {
    prisma = new PrismaService(config);
    await prisma.$connect();
    access = new MerchantAccessService(prisma, new PasswordService(), config);
    offers = new MerchantOffersService(prisma, config);
    const category = await prisma.category.create({
      data: { name: prefix, slug: prefix },
    });
    categoryId = category.id;
    const brand = await prisma.brand.create({
      data: { name: prefix, slug: prefix },
    });
    const product = await prisma.product.create({
      data: { name: prefix, slug: prefix, categoryId, brandId: brand.id },
    });
    productId = product.id;
    a = (
      await prisma.merchant.create({
        data: { name: `${prefix}-A`, slug: `${prefix}-a` },
      })
    ).id;
    b = (
      await prisma.merchant.create({
        data: { name: `${prefix}-B`, slug: `${prefix}-b` },
      })
    ).id;
    await access.provision(
      a,
      { username: `${prefix}-a`, password },
      'firebase:test-admin',
    );
    await access.provision(
      b,
      { username: `${prefix}-b`, password },
      'firebase:test-admin',
    );
    other = await offers.create(b, {
      ...input(),
      merchantSku: 'PRIVATE-SKU-B',
    });

    // Exercise the emitted Nest metadata, real guards/controllers/DTOs and real
    // PostgreSQL. Only Firebase's external identity boundary is stubbed.
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
            return { id: 'firebase:test-admin', role: 'platform_admin' };
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
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1`;
    const response = await call(
      '/merchant/auth/login',
      'POST',
      { username: `${prefix}-a`, password },
      null,
    );
    expect(response.status).toBe(200);
    session = (await response.json()) as MerchantLoginResponseDto;
  }, 15000);

  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    token: string | null = session?.token,
  ): Promise<Response> {
    return await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Merchant-Id': b,
        'X-Role': 'platform_admin',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  afterAll(async () => {
    await app?.close();
    if (!prisma) return;
    await prisma.$connect();
    await prisma.merchantUser.deleteMany({
      where: { merchantId: { in: [a, b, fresh].filter(Boolean) } },
    });
    await prisma.priceHistory.deleteMany({
      where: {
        merchantProduct: { merchantId: { in: [a, b].filter(Boolean) } },
      },
    });
    await prisma.merchantProduct.deleteMany({
      where: { merchantId: { in: [a, b].filter(Boolean) } },
    });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.merchant.deleteMany({
      where: { slug: { startsWith: prefix } },
    });
    await prisma.brand.deleteMany({ where: { slug: prefix } });
    await prisma.category.deleteMany({ where: { slug: prefix } });
    await prisma.$disconnect();
  });

  it('returns JSON for an unconfigured store and provisions its first login through the real HTTP contract', async () => {
    fresh = (
      await prisma.merchant.create({
        data: { name: `${prefix}-fresh`, slug: `${prefix}-fresh` },
      })
    ).id;
    const path = `/admin/merchants/${fresh}/login`;
    const empty = await call(path, 'GET', undefined, adminToken);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('content-type')).toContain('application/json');
    expect(await empty.json()).toEqual({ login: null });
    const username = `${prefix}-fresh`;
    expect(
      (await call(path, 'POST', { username, password }, adminToken)).status,
    ).toBe(201);
    const configured = await call(path, 'GET', undefined, adminToken);
    expect(await configured.json()).toEqual({
      login: { username, active: true },
    });
    const loggedIn = await call(
      '/merchant/auth/login',
      'POST',
      { username, password },
      null,
    );
    expect(loggedIn.status).toBe(200);
    expect(
      ((await loggedIn.json()) as MerchantLoginResponseDto).merchant.id,
    ).toBe(fresh);
  });

  it('denies anonymous access, malformed tokens and client-supplied authority', async () => {
    for (const [method, path] of [
      ['GET', '/merchant/auth/me'],
      ['POST', '/merchant/auth/logout'],
      ['GET', '/merchant/offers'],
      ['GET', '/merchant/catalog/products'],
      ['POST', '/merchant/offers'],
      ['GET', `/merchant/offers/${other.id}`],
      ['PATCH', `/merchant/offers/${other.id}`],
      ['DELETE', `/merchant/offers/${other.id}`],
    ]) {
      expect((await call(path, method, undefined, null)).status).toBe(401);
      expect((await call(path, method, undefined, 'forged')).status).toBe(401);
    }
    expect(
      (
        await call('/merchant/offers', 'POST', {
          ...input(),
          merchantId: b,
          actorId: 'admin',
        })
      ).status,
    ).toBe(400);
    expect((await call(`/merchant/offers?merchantId=${b}`)).status).toBe(400);
  });

  it('keeps credentials/private fields out of session and public responses', async () => {
    const response = await call('/merchant/auth/me');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const me = (await response.json()) as MerchantSessionDto;
    expect(me.merchant.id).toBe(a);
    expect(Object.keys(me).sort()).toEqual([
      'expiresAt',
      'merchant',
      'username',
    ]);
    const record = await prisma.merchantSession.findUnique({
      where: { tokenHash: hashSessionToken(session.token) },
    });
    expect(record).not.toBeNull();
    expect(JSON.stringify(record)).not.toContain(session.token);
    for (const path of [
      `/products/${prefix}`,
      `/merchants/${prefix}-b/offers`,
      `/merchants/${prefix}-b`,
    ]) {
      const result = await call(path, 'GET', undefined, null);
      expect(result.status).toBe(200);
      const text = await result.text();
      expect(text).not.toContain('PRIVATE-SKU');
      expect(text).not.toContain('passwordHash');
      expect(text).not.toContain('tokenHash');
      expect(text).not.toContain('"stockQuantity":23');
    }
  });

  it('rejects copied offer IDs for reads, edits, removal and unknown import routes', async () => {
    expect((await call(`/merchant/offers/${other.id}`)).status).toBe(404);
    const values = input();
    delete values.productId;
    expect(
      (
        await call(`/merchant/offers/${other.id}`, 'PATCH', {
          ...values,
          active: true,
          expectedUpdatedAt: other.updatedAt,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/merchant/offers/${other.id}`, 'DELETE', {
          confirmed: true,
          expectedUpdatedAt: other.updatedAt,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/merchant/imports/${randomUUID()}/commit`, 'POST', {
          confirmed: true,
        })
      ).status,
    ).toBe(404);
    expect((await offers.detail(b, other.id)).price.amount).toBe('100.00');
    expect((await call('/merchant/offers')).status).toBe(200);
    expect(
      ((await (await call('/merchant/offers')).json()) as AdminOfferListDto)
        .items,
    ).toHaveLength(0);
  });

  it('cannot use a merchant session for any admin route including provisioning and imports', async () => {
    for (const [method, path] of [
      ['GET', '/admin/merchants'],
      ['GET', `/admin/merchants/${b}/offers`],
      ['POST', `/admin/merchants/${b}/offers`],
      ['PATCH', `/admin/merchants/${b}/offers/${other.id}`],
      ['DELETE', `/admin/merchants/${b}/offers/${other.id}`],
      ['GET', `/admin/merchants/${b}/login`],
      ['POST', `/admin/merchants/${b}/login`],
      ['PATCH', `/admin/merchants/${b}/login`],
      ['GET', `/admin/imports/${randomUUID()}`],
      ['POST', `/admin/imports/${randomUUID()}/commit`],
    ])
      expect((await call(path, method)).status).toBe(401);
  });

  it('adds, edits, rejects stale versions, removes and restores only its own listing with truthful history', async () => {
    const created = await call('/merchant/offers', 'POST', input());
    expect(created.status).toBe(201);
    const own = (await created.json()) as AdminOfferDto;
    expect((await call('/merchant/offers', 'POST', input())).status).toBe(409);
    const values = input();
    delete values.productId;
    const updated = await call(`/merchant/offers/${own.id}`, 'PATCH', {
      ...values,
      active: true,
      price: '1.299,00',
      confirmWarnings: true,
      expectedUpdatedAt: own.updatedAt,
    });
    expect(updated.status).toBe(200);
    const current = (await updated.json()) as AdminOfferDto;
    expect(current.price.amount).toBe('1299.00');
    expect(
      (
        await call(`/merchant/offers/${own.id}`, 'PATCH', {
          ...values,
          active: true,
          expectedUpdatedAt: own.updatedAt,
        })
      ).status,
    ).toBe(409);
    const history = await prisma.priceHistory.findMany({
      where: { merchantProductId: own.id },
    });
    expect(history).toHaveLength(2);
    expect(history.every((row) => row.actorId?.startsWith('merchant:'))).toBe(
      true,
    );
    const removed = await call(`/merchant/offers/${own.id}`, 'DELETE', {
      confirmed: true,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(removed.status).toBe(200);
    const hidden = (await removed.json()) as AdminOfferDto;
    expect(hidden.active).toBe(false);
    expect(
      (await prisma.merchantProduct.findUnique({ where: { id: own.id } }))
        ?.removedBy,
    ).toMatch(/^merchant:/);
    expect((await offers.detail(b, other.id)).active).toBe(true);
    // Editing an already-hidden offer must also preserve who removed it.
    const audited = await offers.update(
      a,
      own.id,
      {
        ...values,
        price: '1299.00',
        active: false,
        expectedUpdatedAt: hidden.updatedAt,
      },
      'firebase:different-editor',
    );
    expect(
      (await prisma.merchantProduct.findUnique({ where: { id: own.id } }))
        ?.removedBy,
    ).toMatch(/^merchant:/);
    const hiddenEdit = await call(`/merchant/offers/${own.id}`, 'PATCH', {
      ...values,
      price: '1.298,00',
      active: false,
      expectedUpdatedAt: audited.updatedAt,
    });
    expect(hiddenEdit.status).toBe(200);
    const stillHidden = (await hiddenEdit.json()) as AdminOfferDto;
    expect(stillHidden.active).toBe(false);
    expect(stillHidden.price.amount).toBe('1298.00');
    const publicOffers = await call(
      `/merchants/${prefix}-a/offers`,
      'GET',
      undefined,
      null,
    );
    expect(publicOffers.status).toBe(200);
    expect(
      ((await publicOffers.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);
    const restored = await call(`/merchant/offers/${own.id}`, 'PATCH', {
      ...values,
      price: '1298.00',
      active: true,
      expectedUpdatedAt: stillHidden.updatedAt,
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as AdminOfferDto).active).toBe(true);
    expect(
      await prisma.priceHistory.count({ where: { merchantProductId: own.id } }),
    ).toBe(3);
  });

  it('rejects an expired session and blocks login for an inactive merchant', async () => {
    await prisma.merchantSession.update({
      where: { tokenHash: hashSessionToken(session.token) },
      data: { expiresAt: new Date(0) },
    });
    expect((await call('/merchant/auth/me')).status).toBe(401);
    await prisma.merchant.update({ where: { id: a }, data: { active: false } });
    expect(
      (
        await call(
          '/merchant/auth/login',
          'POST',
          { username: `${prefix}-a`, password },
          null,
        )
      ).status,
    ).toBe(401);
    await prisma.merchant.update({ where: { id: a }, data: { active: true } });
    session = await access.login({ username: `${prefix}-a`, password });
  });

  it('password reset, disable and logout revoke sessions including authority captured before the change', async () => {
    const actor = await access.authenticate(session.token);
    await access.setActive(a, false, 'firebase:test-admin');
    expect((await call('/merchant/auth/me')).status).toBe(401);
    await expect(
      offers.create(a, input(), `merchant:${actor.userId}`, actor),
    ).rejects.toMatchObject({ status: 401 });
    await access.provision(
      a,
      { username: `${prefix}-a`, password },
      'firebase:test-admin',
    );
    expect((await call('/merchant/auth/me')).status).toBe(401);
    session = await access.login({ username: `${prefix}-a`, password });
    const beforeLogout = await access.authenticate(session.token);
    expect((await call('/merchant/auth/logout', 'POST')).status).toBe(204);
    await expect(
      offers.create(
        a,
        input(),
        `merchant:${beforeLogout.userId}`,
        beforeLogout,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('persists account attempt limits and uses the same failure for unknown usernames', async () => {
    await prisma.merchantUser.update({
      where: { merchantId: b },
      data: {
        loginAttempts: 5,
        attemptsResetAt: new Date(Date.now() + 60_000),
      },
    });
    const blocked = await call(
      '/merchant/auth/login',
      'POST',
      { username: `${prefix}-b`, password },
      null,
    );
    const unknown = await call(
      '/merchant/auth/login',
      'POST',
      { username: `${prefix}-missing`, password },
      null,
    );
    expect(blocked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(((await blocked.json()) as { message: string }).message).toEqual(
      ((await unknown.json()) as { message: string }).message,
    );
  });
});
