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
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import sharp from 'sharp';
import { Workbook } from 'exceljs';
import { PrismaService } from '../src/database/prisma.service';
import { MerchantAccessService } from '../src/merchant-access/merchant-access.service';
import { PasswordService } from '../src/merchant-access/password.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CANONICAL_IMPORT_FIELDS } from '../src/imports/import-normalization';
import type { ParsedCsvRow } from '../src/imports/csv-parser';
import type { AdminImportDetailDto } from '../src/imports/imports.dto';
import type { MerchantLoginResponseDto } from '../src/merchant-access/merchant-access.dto';
import type { CommitPhotoImportDto } from '../src/imports/photo-import.dto';
import { ImportStagingService } from '../src/imports/import-staging.service';

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
    const realOcr = new CompiledOcr(config);
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

  async function fileBody(
    source: 'csv' | 'xlsx',
    rows: Record<string, string | number>[],
  ): Promise<FormData> {
    const headers = [...CANONICAL_IMPORT_FIELDS];
    let bytes: Uint8Array<ArrayBuffer>;
    if (source === 'xlsx') {
      const book = new Workbook();
      const sheet = book.addWorksheet('Products');
      sheet.addRow(headers);
      for (const row of rows)
        sheet.addRow(headers.map((key) => row[key] ?? ''));
      bytes = new Uint8Array(await book.xlsx.writeBuffer());
    } else {
      bytes = new TextEncoder().encode(
        [
          headers.join(','),
          ...rows.map((row) =>
            headers
              .map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`)
              .join(','),
          ),
        ].join('\n'),
      );
    }
    const form = new FormData();
    form.append('file', new Blob([bytes]), `products.${source}`);
    return form;
  }
  async function stageFile(
    source: 'csv' | 'xlsx',
    rows: Record<string, string | number>[] = [makeRow().rawData],
  ): Promise<AdminImportDetailDto> {
    const response = await call(
      `/merchant/file-imports/${source}`,
      'POST',
      await fileBody(source, rows),
    );
    const result = (await response.json()) as AdminImportDetailDto;
    expect(response.status, JSON.stringify(result)).toBe(201);
    expect(result.sourceType).toBe(source.toUpperCase());
    expect(result.merchant.id).toBe(a);
    return result;
  }
  function fileConfirmation(
    preview: AdminImportDetailDto,
  ): Omit<CommitPhotoImportDto, 'reviewedPhoto'> {
    return {
      expectedPreviewToken: preview.previewToken,
      confirmed: true,
      confirmWarnings: true,
      confirmNewProducts: true,
    };
  }

  for (const source of ['csv', 'xlsx'] as const) {
    it(`${source}: previews, partially commits, corrects remainder and commits idempotently without OCR`, async () => {
      const calls = providerCalls;
      const first = makeRow().rawData;
      const second = makeRow({ barcode: '0000000000000' }).rawData;
      const preview = await stageFile(source, [first, second]);
      expect(preview.rows[0].input?.merchantSku).toBe(first.merchantSku);
      expect(preview.rows[1].status).toBe('INVALID');
      expect(
        await prisma.product.count({
          where: { name: { in: [first.productName, second.productName] } },
        }),
      ).toBe(0);
      expect(
        (
          await call(`/merchant/file-imports/${preview.id}/commit`, 'POST', {
            ...fileConfirmation(preview),
            confirmWarnings: false,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await call(`/merchant/file-imports/${preview.id}/commit`, 'POST', {
            ...fileConfirmation(preview),
            confirmNewProducts: false,
          })
        ).status,
      ).toBe(409);
      const commit = await call(
        `/merchant/file-imports/${preview.id}/commit`,
        'POST',
        fileConfirmation(preview),
      );
      expect(commit.status).toBe(201);
      expect(
        (
          await call(
            `/merchant/file-imports/${preview.id}/commit`,
            'POST',
            fileConfirmation(preview),
          )
        ).status,
      ).toBe(201);
      expect(
        await prisma.product.count({ where: { name: first.productName } }),
      ).toBe(1);
      expect(
        await prisma.product.count({ where: { name: second.productName } }),
      ).toBe(0);
      const remainder = (await (
        await call(`/merchant/file-imports/${preview.id}/remaining`, 'POST')
      ).json()) as AdminImportDetailDto;
      expect(remainder.rows).toHaveLength(1);
      expect(
        (
          await call(`/merchant/file-imports/${remainder.id}/cancel`, 'POST', {
            expectedPreviewToken: remainder.previewToken,
          })
        ).status,
      ).toBe(201);
      const retry = (await (
        await call(`/merchant/file-imports/${preview.id}/remaining`, 'POST')
      ).json()) as AdminImportDetailDto;
      expect(retry.id).not.toBe(remainder.id);
      const correctedResponse = await call(
        `/merchant/file-imports/${retry.id}/rows/${retry.rows[0].id}`,
        'PATCH',
        {
          expectedPreviewToken: retry.previewToken,
          input: { ...retry.rows[0].input, barcode: '' },
          skip: false,
        },
      );
      expect(correctedResponse.status).toBe(200);
      const corrected =
        (await correctedResponse.json()) as AdminImportDetailDto;
      expect(
        (
          await call(
            `/merchant/file-imports/${retry.id}/commit`,
            'POST',
            fileConfirmation(retry),
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await call(
            `/merchant/file-imports/${retry.id}/commit`,
            'POST',
            fileConfirmation(corrected),
          )
        ).status,
      ).toBe(201);
      expect(
        await prisma.product.count({ where: { name: second.productName } }),
      ).toBe(1);
      expect(providerCalls).toBe(calls);
    });
  }

  it('file routes reject anonymous, injected tenants and cross-store or cross-source IDs; work with photos disabled', async () => {
    const before = providerCalls;
    expect(
      (
        await call(
          '/merchant/file-imports/csv',
          'POST',
          await fileBody('csv', [makeRow().rawData]),
          null,
        )
      ).status,
    ).toBe(401);
    const injected = await fileBody('csv', [makeRow().rawData]);
    injected.append('merchantId', b);
    expect(
      (await call('/merchant/file-imports/csv', 'POST', injected)).status,
    ).toBe(400);
    const preview = await stageFile('csv');
    for (const [suffix, method, body] of [
      ['', 'GET', undefined],
      ['/commit', 'POST', fileConfirmation(preview)],
      ['/cancel', 'POST', { expectedPreviewToken: preview.previewToken }],
      ['/remaining', 'POST', undefined],
      [
        `/rows/${preview.rows[0].id}`,
        'PATCH',
        {
          expectedPreviewToken: preview.previewToken,
          input: preview.rows[0].input,
          skip: false,
        },
      ],
    ] as const)
      expect(
        (
          await call(
            `/merchant/file-imports/${preview.id}${suffix}`,
            method,
            body,
            sessionB.token,
          )
        ).status,
      ).toBe(404);
    const list = (await (
      await call('/merchant/file-imports', 'GET', undefined, sessionB.token)
    ).json()) as { items: { id: string }[] };
    expect(list.items.some((item) => item.id === preview.id)).toBe(false);
    expect((await call(`/merchant/imports/${preview.id}`)).status).toBe(404);
    expect(
      (
        await call(
          `/merchant/imports/${preview.id}/commit`,
          'POST',
          commitBody(preview),
        )
      ).status,
    ).toBe(404);
    const photo = await stage([makeRow()]);
    expect((await call(`/merchant/file-imports/${photo.id}`)).status).toBe(404);
    const bytes = Buffer.from(
      'merchantSku,productName,brand,price,currency\nadmin-only,admin-only,test,10,BRL',
    );
    const adminId = await new ImportStagingService(prisma, config).stageCsv(
      { merchantId: a },
      {
        buffer: bytes,
        originalname: 'admin.csv',
        size: bytes.length,
        mimetype: 'text/csv',
      },
    );
    expect((await call(`/merchant/file-imports/${adminId}`)).status).toBe(404);
    expect(
      (
        await call(
          `/merchant/file-imports/${adminId}/commit`,
          'POST',
          fileConfirmation(preview),
        )
      ).status,
    ).toBe(404);
    config.set('PHOTO_IMPORT_ENABLED', false);
    try {
      expect((await call(`/merchant/file-imports/${preview.id}`)).status).toBe(
        200,
      );
      await stageFile('xlsx');
    } finally {
      config.set('PHOTO_IMPORT_ENABLED', true);
    }
    expect(providerCalls).toBe(before + 1);
  });

  it('retains numeric Excel SKU warnings when another row is corrected', async () => {
    const row = makeRow().rawData;
    const preview = await stageFile('xlsx', [
      { ...row, merchantSku: 12345 },
      makeRow({ price: '-1' }).rawData,
    ]);
    expect(
      preview.rows[0].warnings.some((warning) =>
        warning.includes('numeric merchantSku'),
      ),
    ).toBe(true);
    const corrected = (await (
      await call(
        `/merchant/file-imports/${preview.id}/rows/${preview.rows[1].id}`,
        'PATCH',
        {
          expectedPreviewToken: preview.previewToken,
          input: { ...preview.rows[1].input, price: '50' },
          skip: false,
        },
      )
    ).json()) as AdminImportDetailDto;
    expect(
      corrected.rows[0].warnings.some((warning) =>
        warning.includes('numeric merchantSku'),
      ),
    ).toBe(true);
    expect(
      (
        await call(`/merchant/file-imports/${preview.id}/commit`, 'POST', {
          ...fileConfirmation(corrected),
          confirmWarnings: false,
        })
      ).status,
    ).toBe(409);
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
  it('file upload rejects oversized and malformed files, extra files, and merchant access to admin routes', async () => {
    const count = await prisma.import.count({ where: { merchantId: a } });
    const oversized = new FormData();
    oversized.append(
      'file',
      new Blob([new Uint8Array(2_097_153)]),
      'large.csv',
    );
    expect(
      (await call('/merchant/file-imports/csv', 'POST', oversized)).status,
    ).toBe(413);
    const invalid = new FormData();
    invalid.append('file', new Blob(['not an XLSX archive']), 'bad.xlsx');
    expect(
      (await call('/merchant/file-imports/xlsx', 'POST', invalid)).status,
    ).toBe(400);
    const multiple = await fileBody('csv', [makeRow().rawData]);
    multiple.append('file', new Blob(['second']), 'second.csv');
    expect(
      (await call('/merchant/file-imports/csv', 'POST', multiple)).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/admin/imports/csv',
          'POST',
          await fileBody('csv', [makeRow().rawData]),
        )
      ).status,
    ).toBe(401);
    expect(await prisma.import.count({ where: { merchantId: a } })).toBe(count);
    config.set('MERCHANT_ACCESS_ENABLED', false);
    try {
      expect((await call('/merchant/file-imports')).status).toBe(404);
    } finally {
      config.set('MERCHANT_ACCESS_ENABLED', true);
    }
  });
  it('file upload rechecks a session revoked during parsing before writing staging rows', async () => {
    const { ImportStagingService: CompiledStaging } =
      require('../dist/imports/import-staging.service.js') as typeof import('../src/imports/import-staging.service');
    const staging = app.get(CompiledStaging);
    const prepare = staging.prepareRows.bind(staging);
    const before = await prisma.import.count({ where: { merchantId: b } });
    const spy = vi
      .spyOn(staging, 'prepareRows')
      .mockImplementationOnce(async (...args) => {
        const prepared = await prepare(...args);
        await access.setActive(b, false, 'test-admin');
        return prepared;
      });
    try {
      expect(
        (
          await call(
            '/merchant/file-imports/xlsx',
            'POST',
            await fileBody('xlsx', [makeRow().rawData]),
            sessionB.token,
          )
        ).status,
      ).toBe(401);
      expect(await prisma.import.count({ where: { merchantId: b } })).toBe(
        before,
      );
    } finally {
      spy.mockRestore();
      await access.setActive(b, true, 'test-admin');
      sessionB = await access.login({ username: `${prefix}-b`, password });
    }
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
    const twoFiles = uploadBody();
    twoFiles.append('file', new Blob([new Uint8Array(png)]), 'second.png');
    expect(
      (await call('/merchant/imports/photo', 'POST', twoFiles)).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/merchant/imports/photo',
          'POST',
          uploadBody(false, Buffer.alloc(5 * 1024 * 1024 + 1)),
        )
      ).status,
    ).toBe(413);
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
    const csv = await prisma.import.create({
      data: { merchantId: a, sourceType: 'CSV', status: 'READY' },
    });
    expect((await call(`/merchant/imports/${csv.id}`)).status).toBe(404);
    expect(
      (
        await call(
          `/merchant/imports/${csv.id}/commit`,
          'POST',
          commitBody(other),
        )
      ).status,
    ).toBe(404);
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
    for (const missing of [
      { confirmed: false },
      { confirmWarnings: false },
      { confirmNewProducts: false },
    ]) {
      const denied = await call(
        `/merchant/imports/${preview.id}/commit`,
        'POST',
        { ...commitBody(preview), ...missing },
      );
      expect([400, 409]).toContain(denied.status);
    }
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
  it('recreates cancelled remainders idempotently without another provider call', async () => {
    const preview = await stage([makeRow(), makeRow({ price: 'invalid' })]);
    expect(
      (
        await call(
          `/merchant/imports/${preview.id}/commit`,
          'POST',
          commitBody(preview),
        )
      ).status,
    ).toBe(201);
    const first = (await (
      await call(`/merchant/imports/${preview.id}/remaining`, 'POST')
    ).json()) as AdminImportDetailDto;
    expect(
      (
        await call(`/merchant/imports/${first.id}/cancel`, 'POST', {
          expectedPreviewToken: first.previewToken,
        })
      ).status,
    ).toBe(201);
    const calls = providerCalls;
    const responses = await Promise.all([
      call(`/merchant/imports/${preview.id}/remaining`, 'POST'),
      call(`/merchant/imports/${preview.id}/remaining`, 'POST'),
    ]);
    const [a, b] = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(201);
        return (await response.json()) as AdminImportDetailDto;
      }),
    );
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(first.id);
    expect(a.status).toBe('READY');
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].input?.price).toBe('invalid');
    expect(
      (await prisma.import.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('CANCELLED');
    expect(providerCalls).toBe(calls);
    expect(
      await prisma.priceHistory.count({ where: { importId: preview.id } }),
    ).toBe(1);
  });
  it('marks only this store expired photo reservations failed and preserves current reads', async () => {
    const expired = new Date(Date.now() - 6 * 60_000);
    const old = await prisma.import.create({
      data: {
        merchantId: a,
        sourceType: 'PHOTO',
        status: 'UPLOADED',
        createdAt: expired,
      },
    });
    const other = await prisma.import.create({
      data: {
        merchantId: b,
        sourceType: 'PHOTO',
        status: 'UPLOADED',
        createdAt: expired,
      },
    });
    const active = await prisma.import.create({
      data: { merchantId: a, sourceType: 'PHOTO', status: 'UPLOADED' },
    });
    const csv = await prisma.import.create({
      data: {
        merchantId: a,
        sourceType: 'CSV',
        status: 'UPLOADED',
        createdAt: expired,
      },
    });
    expect((await call('/merchant/imports')).status).toBe(200);
    const status = async (id: string): Promise<string> =>
      (await prisma.import.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(old.id)).toBe('FAILED');
    expect(await status(other.id)).toBe('UPLOADED');
    expect(await status(active.id)).toBe('UPLOADED');
    expect(await status(csv.id)).toBe('UPLOADED');
  });
  it('rejects a second simultaneous read with a busy message and no paid call', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    beforeExtract = async () => {
      entered?.();
      await wait;
    };
    extraction = [makeRow()];
    const first = call('/merchant/imports/photo', 'POST', uploadBody());
    await started;
    const calls = providerCalls;
    try {
      const second = await call(
        '/merchant/imports/photo',
        'POST',
        uploadBody(),
        sessionB.token,
      );
      expect(second.status).toBe(429);
      expect(((await second.json()) as { message: string }).message).toBe(
        'PHOTO_READER_BUSY',
      );
      expect(providerCalls).toBe(calls);
    } finally {
      release?.();
      await first;
    }
  });
  it('caps total daily paid calls across stores at twenty', async () => {
    await prisma.import.createMany({
      data: Array.from({ length: 20 }, () => ({
        merchantId: b,
        sourceType: 'PHOTO' as const,
        status: 'FAILED' as const,
      })),
    });
    const calls = providerCalls;
    expect(
      (await call('/merchant/imports/photo', 'POST', uploadBody())).status,
    ).toBe(429);
    expect(providerCalls).toBe(calls);
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
  it('keeps an explicitly skipped unchanged row available for correction', async () => {
    const original = makeRow();
    const first = await stage([original]);
    expect(
      (
        await call(
          `/merchant/imports/${first.id}/commit`,
          'POST',
          commitBody(first),
        )
      ).status,
    ).toBe(201);
    const preview = await stage([original, makeRow()]);
    expect(preview.rows[0].action).toBe('UNCHANGED');
    const skipped = await call(
      `/merchant/imports/${preview.id}/rows/${preview.rows[0].id}`,
      'PATCH',
      {
        expectedPreviewToken: preview.previewToken,
        input: preview.rows[0].input,
        skip: true,
      },
    );
    expect(skipped.status).toBe(200);
    const updated = (await skipped.json()) as AdminImportDetailDto;
    expect(updated.rows[0].action).toBe('BLOCKED');
    expect(
      (
        await call(
          `/merchant/imports/${updated.id}/commit`,
          'POST',
          commitBody(updated),
        )
      ).status,
    ).toBe(201);
    const remainder = await call(
      `/merchant/imports/${updated.id}/remaining`,
      'POST',
    );
    expect(remainder.status).toBe(201);
    const next = (await remainder.json()) as AdminImportDetailDto;
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0].merchantSku).toBe(
      original.rawData.merchantSku.toUpperCase(),
    );
    expect(next.rows[0].action).toBe('UNCHANGED');
  });
  it('blocks an offer changed after preview until the operator saves and confirms an updated preview', async () => {
    const original = makeRow();
    const first = await stage([original]);
    expect(
      (
        await call(
          `/merchant/imports/${first.id}/commit`,
          'POST',
          commitBody(first),
        )
      ).status,
    ).toBe(201);
    const preview = await stage([
      { ...original, rawData: { ...original.rawData, price: '120' } },
    ]);
    const offer = await prisma.merchantProduct.findUniqueOrThrow({
      where: {
        merchantId_merchantSku: {
          merchantId: a,
          merchantSku: original.rawData.merchantSku.toUpperCase(),
        },
      },
    });
    await prisma.merchantProduct.update({
      where: { id: offer.id },
      data: {
        price: '110',
        updatedAt: new Date(offer.updatedAt.getTime() + 1000),
      },
    });
    expect(
      (
        await call(
          `/merchant/imports/${preview.id}/commit`,
          'POST',
          commitBody(preview),
        )
      ).status,
    ).toBe(409);
    expect(
      await prisma.priceHistory.count({ where: { importId: preview.id } }),
    ).toBe(0);
    const refreshed = await call(
      `/merchant/imports/${preview.id}/rows/${preview.rows[0].id}`,
      'PATCH',
      {
        expectedPreviewToken: preview.previewToken,
        input: preview.rows[0].input,
        skip: false,
      },
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as AdminImportDetailDto;
    expect(next.rows[0].currentPrice?.amount).toBe('110');
    expect(
      (
        await call(
          `/merchant/imports/${next.id}/commit`,
          'POST',
          commitBody(next),
        )
      ).status,
    ).toBe(201);
  });
  it('commits the full 100-row photo limit once and does not duplicate it on retry', async () => {
    const preview = await stage(Array.from({ length: 100 }, () => makeRow()));
    const commit = await call(
      `/merchant/imports/${preview.id}/commit`,
      'POST',
      commitBody(preview),
    );
    expect(commit.status).toBe(201);
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
      await prisma.priceHistory.count({ where: { importId: preview.id } }),
    ).toBe(100);
  }, 35000);
  it('rejects a revoked login between preview and commit without publishing any row', async () => {
    const preview = await stage([makeRow()], sessionB.token);
    await access.setActive(b, false, 'test-admin');
    expect(
      (
        await call(
          `/merchant/imports/${preview.id}/commit`,
          'POST',
          commitBody(preview),
          sessionB.token,
        )
      ).status,
    ).toBe(401);
    expect(
      await prisma.priceHistory.count({ where: { importId: preview.id } }),
    ).toBe(0);
    await access.setActive(b, true, 'test-admin');
    sessionB = await access.login({ username: `${prefix}-b`, password });
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
