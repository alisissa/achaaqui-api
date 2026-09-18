import 'reflect-metadata';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  ValidationPipe,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PrismaService } from '../src/database/prisma.service';
import { MerchantAccessService } from '../src/merchant-access/merchant-access.service';
import { PasswordService } from '../src/merchant-access/password.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PhotoOcrService } from '../src/imports/photo-ocr.service';
import { CANONICAL_IMPORT_FIELDS } from '../src/imports/import-normalization';
import type { ParsedCsvRow } from '../src/imports/csv-parser';
import type { AdminImportDetailDto } from '../src/imports/imports.dto';
import type { MerchantLoginResponseDto } from '../src/merchant-access/merchant-access.dto';
import type { CommitPhotoImportDto } from '../src/imports/photo-import.dto';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Photo tests require a disposable localhost test database.');
const run = url ? describe : describe.skip;
const require = createRequire(
  `${process.cwd()}/test/photo-import.integration.spec.ts`,
);
const prefix = `photo-${randomUUID().slice(0, 8)}`;

run('photo import HTTP isolation and lifecycle', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  let a: string;
  let b: string;
  let token: string;
  let sessionB: MerchantLoginResponseDto;
  let access: MerchantAccessService;
  let png: Buffer;
  let extraction: ParsedCsvRow[];
  let beforeExtract: (() => Promise<void>) | undefined;
  let providerCalls = 0;
  let sequence = 0;
  const password = randomBytes(24).toString('base64url');
  const config = new ConfigService({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    MERCHANT_ACCESS_ENABLED: true,
    PHOTO_IMPORT_ENABLED: true,
    ADMIN_AUTH_MODE: 'firebase',
    FIREBASE_PROJECT_ID: 'achaaqui-web',
    IMPORT_SUPPORTED_CURRENCIES: 'BRL,USD,PYG',
  });
  const makeRow = (
    data: Record<string, string> = {},
    errors: string[] = [],
  ): ParsedCsvRow => {
    sequence++;
    return {
      sourceRowNumber: 1,
      rawData: {
        ...Object.fromEntries(
          CANONICAL_IMPORT_FIELDS.map((field) => [field, '']),
        ),
        merchantSku: `${prefix}-${sequence}`,
        productName: `${prefix}-product-${sequence}`,
        brand: prefix,
        price: '100',
        currency: 'BRL',
        stock: '1',
        availability: 'TRUE',
        ...data,
      },
      warnings: ['PHOTO_REVIEW_REQUIRED'],
      errors,
    };
  };
  beforeAll(async () => {
    prisma = new PrismaService(config);
    await prisma.$connect();
    a = (
      await prisma.merchant.create({
        data: { name: prefix, slug: `${prefix}-a` },
      })
    ).id;
    b = (
      await prisma.merchant.create({
        data: { name: prefix, slug: `${prefix}-b` },
      })
    ).id;
    access = new MerchantAccessService(prisma, new PasswordService(), config);
    await access.provision(
      a,
      { username: `${prefix}-a`, password },
      'test-admin',
    );
    await access.provision(
      b,
      { username: `${prefix}-b`, password },
      'test-admin',
    );
    token = (await access.login({ username: `${prefix}-a`, password })).token;
    sessionB = await access.login({ username: `${prefix}-b`, password });
    png = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const { AppModule } =
      require('../dist/app.module.js') as typeof import('../src/app.module');
    const { PrismaService: CompiledPrisma } =
      require('../dist/database/prisma.service.js') as typeof import('../src/database/prisma.service');
    const { PhotoOcrService: CompiledOcr } =
      require('../dist/imports/photo-ocr.service.js') as typeof import('../src/imports/photo-ocr.service');
    const { FirebaseAdminAuthService } =
      require('../dist/admin-auth/firebase-admin-auth.service.js') as typeof import('../src/admin-auth/firebase-admin-auth.service');
    const realOcr = new PhotoOcrService(config);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(CompiledPrisma)
      .useValue(prisma)
      .overrideProvider(CompiledOcr)
      .useValue({
        sanitize: realOcr.sanitize.bind(realOcr),
        extract: async () => {
          providerCalls++;
          await beforeExtract?.();
          return extraction;
        },
      })
      .overrideProvider(FirebaseAdminAuthService)
      .useValue({
        verify: () => {
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
  }, 20000);
  afterEach(async () => {
    beforeExtract = undefined;
    // Only this test's imports; avoids the production quota affecting independent fixtures.
    await prisma.import.updateMany({
      where: { merchantId: { in: [a, b] } },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.priceHistory.deleteMany({
      where: { merchantProduct: { merchantId: { in: [a, b] } } },
    });
    await prisma.import.deleteMany({ where: { merchantId: { in: [a, b] } } });
    await prisma.merchantProduct.deleteMany({
      where: { merchantId: { in: [a, b] } },
    });
    await prisma.merchantSession.deleteMany({
      where: { user: { merchantId: { in: [a, b] } } },
    });
    await prisma.merchantUser.deleteMany({
      where: { merchantId: { in: [a, b] } },
    });
    await prisma.merchant.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.product.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.brand.deleteMany({ where: { name: prefix } });
    await app?.close();
    await prisma.$disconnect();
  });
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    credential: string | null = token,
  ): Promise<Response> {
    const multipart = body instanceof FormData;
    return await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(multipart ? {} : { 'Content-Type': 'application/json' }),
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        'X-Merchant-Id': b,
      },
      body: multipart
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    });
  }
  function uploadBody(extra = false, buffer = png): FormData {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'image/png' }),
      'test.png',
    );
    if (extra) form.append('merchantId', b);
    return form;
  }
  async function stage(
    rows: ParsedCsvRow[],
    credential = token,
  ): Promise<AdminImportDetailDto> {
    extraction = rows.map((row, i) => ({ ...row, sourceRowNumber: i + 1 }));
    const response = await call(
      '/merchant/imports/photo',
      'POST',
      uploadBody(),
      credential,
    );
    const data: unknown = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(201);
    return data as AdminImportDetailDto;
  }
  const commitBody = (preview: AdminImportDetailDto): CommitPhotoImportDto => ({
    expectedPreviewToken: preview.previewToken,
    confirmed: true,
    reviewedPhoto: true,
    confirmWarnings: true,
    confirmNewProducts: true,
  });

  it('denies anonymous upload and hides disabled feature without provider calls', async () => {
    const before = providerCalls;
    expect(
      (await call('/merchant/imports/photo', 'POST', uploadBody(), null))
        .status,
    ).toBe(401);
    config.set('PHOTO_IMPORT_ENABLED', false);
    expect(
      (await call('/merchant/imports/photo', 'POST', uploadBody())).status,
    ).toBe(404);
    config.set('PHOTO_IMPORT_ENABLED', true);
    expect(providerCalls).toBe(before);
  });
  it('rejects extra tenant fields and invalid images before contacting provider', async () => {
    const before = providerCalls;
    expect(
      (await call('/merchant/imports/photo', 'POST', uploadBody(true))).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/merchant/imports/photo',
          'POST',
          uploadBody(false, Buffer.from('not-image')),
        )
      ).status,
    ).toBe(400);
    expect(providerCalls).toBe(before);
  });
  it('scopes read, correction, cancellation, commit and remainder by authenticated merchant', async () => {
    const other = await stage([makeRow()], sessionB.token);
    const row = other.rows[0];
    for (const [path, method, body] of [
      [`/merchant/imports/${other.id}`, 'GET', undefined],
      [
        `/merchant/imports/${other.id}/rows/${row.id}`,
        'PATCH',
        {
          expectedPreviewToken: other.previewToken,
          input: row.input,
          skip: false,
        },
      ],
      [
        `/merchant/imports/${other.id}/cancel`,
        'POST',
        { expectedPreviewToken: other.previewToken },
      ],
      [`/merchant/imports/${other.id}/commit`, 'POST', commitBody(other)],
      [`/merchant/imports/${other.id}/remaining`, 'POST', undefined],
    ] as const)
      expect((await call(path, method, body)).status).toBe(404);
    expect((await call('/admin/imports')).status).toBe(401);
    const own = (await (await call('/merchant/imports')).json()) as {
      items: { id: string }[];
    };
    expect(own.items.some((item) => item.id === other.id)).toBe(false);
  });
  it('commits good rows only, exposes why the other row was blocked, then resolves only the remainder', async () => {
    const good = makeRow();
    const bad = makeRow({ price: 'not a price' });
    const preview = await stage([good, bad]);
    expect(
      await prisma.merchantProduct.count({
        where: {
          merchantId: a,
          merchantSku: good.rawData.merchantSku.toUpperCase(),
        },
      }),
    ).toBe(0);
    expect(preview.rows[1].errors.length).toBeGreaterThan(0);
    expect(
      (
        await call(`/merchant/imports/${preview.id}/commit`, 'POST', {
          ...commitBody(preview),
          reviewedPhoto: false,
        })
      ).status,
    ).toBe(400);
    const result = await call(
      `/merchant/imports/${preview.id}/commit`,
      'POST',
      commitBody(preview),
    );
    expect(result.status).toBe(201);
    expect(
      (
        await call(
          `/merchant/imports/${preview.id}/commit`,
          'POST',
          commitBody(preview),
        )
      ).status,
    ).toBe(201);
    expect(
      await prisma.priceHistory.count({
        where: { importId: preview.id, source: 'PHOTO' },
      }),
    ).toBe(1);
    const remainder = (await (
      await call(`/merchant/imports/${preview.id}/remaining`, 'POST')
    ).json()) as AdminImportDetailDto;
    expect(remainder.rows.length).toBe(1);
    expect(remainder.rows[0].input?.price).toBe('not a price');
    expect(
      (
        (await (
          await call(`/merchant/imports/${preview.id}/remaining`, 'POST')
        ).json()) as AdminImportDetailDto
      ).id,
    ).toBe(remainder.id);
    const fixed = (await (
      await call(
        `/merchant/imports/${remainder.id}/rows/${remainder.rows[0].id}`,
        'PATCH',
        {
          expectedPreviewToken: remainder.previewToken,
          input: { ...remainder.rows[0].input, price: '1299,00' },
          skip: false,
        },
      )
    ).json()) as AdminImportDetailDto;
    expect(fixed.rows[0].proposedPrice?.amount).toBe('1299');
    expect(
      (
        await call(
          `/merchant/imports/${remainder.id}/commit`,
          'POST',
          commitBody(fixed),
        )
      ).status,
    ).toBe(201);
    expect(
      await prisma.priceHistory.count({ where: { importId: preview.id } }),
    ).toBe(1);
  });
  it('blocking barcode/SKU conflicts never silently renames a listing', async () => {
    const original = makeRow({ barcode: '7891234567895' });
    const p = await stage([original]);
    expect(
      (await call(`/merchant/imports/${p.id}/commit`, 'POST', commitBody(p)))
        .status,
    ).toBe(201);
    const conflict = await stage([
      makeRow({ barcode: '7891234567895', merchantSku: 'WRONG-SKU' }),
      makeRow(),
    ]);
    expect(conflict.rows[0].status).toBe('INVALID');
    expect(conflict.rows[0].existingMerchantSku).toBe(
      original.rawData.merchantSku.toUpperCase(),
    );
    expect(
      (
        await call(
          `/merchant/imports/${conflict.id}/commit`,
          'POST',
          commitBody(conflict),
        )
      ).status,
    ).toBe(201);
    const listing = await prisma.merchantProduct.findFirst({
      where: { merchantId: a, product: { barcode: '7891234567895' } },
    });
    expect(listing?.merchantSku).toBe(
      original.rawData.merchantSku.toUpperCase(),
    );
  });
  it('revalidates duplicates after skipping, rejects stale confirmation and preserves original OCR data', async () => {
    const p = await stage([
      makeRow({ merchantSku: 'DUPLICATE' }),
      makeRow({ merchantSku: 'DUPLICATE' }),
    ]);
    expect(p.rows.every((row) => row.status === 'INVALID')).toBe(true);
    const response = await call(
      `/merchant/imports/${p.id}/rows/${p.rows[1].id}`,
      'PATCH',
      {
        expectedPreviewToken: p.previewToken,
        input: p.rows[1].input,
        skip: true,
      },
    );
    expect(response.status).toBe(200);
    const next = (await response.json()) as AdminImportDetailDto;
    expect(next.previewToken).not.toBe(p.previewToken);
    expect(next.rows[0].status).toBe('WARNING');
    expect(
      (await call(`/merchant/imports/${p.id}/commit`, 'POST', commitBody(p)))
        .status,
    ).toBe(409);
    expect(
      (
        await call(`/merchant/imports/${p.id}/rows/${p.rows[0].id}`, 'PATCH', {
          expectedPreviewToken: p.previewToken,
          input: p.rows[0].input,
          skip: false,
        })
      ).status,
    ).toBe(409);
    expect(
      (await prisma.importRow.findUnique({ where: { id: p.rows[1].id } }))
        ?.rawData,
    ).toEqual(p.rows[1].input);
  });
  it('allows only one of concurrent corrections and copied row IDs remain hidden', async () => {
    const p = await stage([makeRow()]);
    const other = await stage([makeRow()], sessionB.token);
    expect(
      (
        await call(
          `/merchant/imports/${p.id}/rows/${other.rows[0].id}`,
          'PATCH',
          {
            expectedPreviewToken: p.previewToken,
            input: p.rows[0].input,
            skip: false,
          },
        )
      ).status,
    ).toBe(404);
    const results = await Promise.all(
      ['110', '120'].map((price) =>
        call(`/merchant/imports/${p.id}/rows/${p.rows[0].id}`, 'PATCH', {
          expectedPreviewToken: p.previewToken,
          input: { ...p.rows[0].input, price },
          skip: false,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('blocks uncertain OCR rows until explicit correction and confirmation', async () => {
    const p = await stage([makeRow({}, ['PHOTO_UNCERTAIN_ROW'])]);
    expect(p.rows[0].status).toBe('INVALID');
    expect(
      (await call(`/merchant/imports/${p.id}/commit`, 'POST', commitBody(p)))
        .status,
    ).toBe(409);
    const corrected = (await (
      await call(`/merchant/imports/${p.id}/rows/${p.rows[0].id}`, 'PATCH', {
        expectedPreviewToken: p.previewToken,
        input: p.rows[0].input,
        skip: false,
      })
    ).json()) as AdminImportDetailDto;
    expect(corrected.rows[0].status).toBe('WARNING');
  });
  it('enforces persistent per-merchant paid-call reservations', async () => {
    await prisma.import.createMany({
      data: Array.from({ length: 3 }, () => ({
        merchantId: a,
        sourceType: 'PHOTO' as const,
        status: 'FAILED' as const,
      })),
    });
    const before = providerCalls;
    expect(
      (await call('/merchant/imports/photo', 'POST', uploadBody())).status,
    ).toBe(429);
    expect(providerCalls).toBe(before);
  });
  it('rechecks authority after OCR and before staging any rows', async () => {
    beforeExtract = async () => {
      await access.setActive(b, false, 'test-admin');
    };
    extraction = [makeRow()];
    expect(
      (
        await call(
          '/merchant/imports/photo',
          'POST',
          uploadBody(),
          sessionB.token,
        )
      ).status,
    ).toBe(401);
    const last = await prisma.import.findFirst({
      where: { merchantId: b },
      orderBy: { createdAt: 'desc' },
      include: { rows: true },
    });
    expect(last?.status).toBe('FAILED');
    expect(last?.rows.length).toBe(0);
  });
});
