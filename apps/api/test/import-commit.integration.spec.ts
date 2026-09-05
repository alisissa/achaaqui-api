import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import {
  ImportRowStatus,
  ImportSource,
  ImportStatus,
  MatchMethod,
  OfferAvailability,
  Prisma,
  ProductStatus,
} from '../src/generated/prisma/client';
import { ImportCommitService } from '../src/imports/import-commit.service';
import { ImportStagingService } from '../src/imports/import-staging.service';
import { IMPORT_ACTIONS, type ImportAction } from '../src/imports/import-types';
import { ImportsService } from '../src/imports/imports.service';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

interface Fixture {
  merchantId: string;
  offerId: string;
  productAId: string;
  productBId: string;
}

describeWithDatabase('CSV import commit integration', () => {
  let prisma: PrismaService;
  let commitService: ImportCommitService;
  let importsService: ImportsService;
  let stagingService: ImportStagingService;
  let fixture: Fixture;

  beforeAll(async () => {
    const config = new ConfigService({
      DATABASE_URL: databaseUrl,
      IMPORT_MAX_FILE_BYTES: 2_097_152,
      IMPORT_MAX_ROWS: 500,
      IMPORT_SUPPORTED_CURRENCIES: 'BRL,USD,PYG',
      IMPORT_SUSPICIOUS_CHANGE_PERCENT: 50,
    });
    prisma = new PrismaService(config);
    await prisma.$connect();
    commitService = new ImportCommitService(prisma);
    importsService = new ImportsService(prisma);
    stagingService = new ImportStagingService(prisma, config);
  });

  beforeEach(async () => {
    const prefix = `import-test-${randomUUID()}`;
    const category = await prisma.category.create({
      data: { name: prefix, slug: `${prefix}-category` },
      select: { id: true },
    });
    const brand = await prisma.brand.create({
      data: { name: prefix, slug: `${prefix}-brand` },
      select: { id: true },
    });
    const merchant = await prisma.merchant.create({
      data: { name: prefix, slug: `${prefix}-merchant` },
      select: { id: true },
    });
    const barcodePrefix = randomUUID()
      .replaceAll('-', '')
      .slice(0, 20)
      .toUpperCase();
    const productA = await prisma.product.create({
      data: {
        barcode: `${barcodePrefix}01`,
        brandId: brand.id,
        categoryId: category.id,
        name: `${prefix} A`,
        slug: `${prefix}-a`,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true },
    });
    const productB = await prisma.product.create({
      data: {
        barcode: `${barcodePrefix}02`,
        brandId: brand.id,
        categoryId: category.id,
        name: `${prefix} B`,
        slug: `${prefix}-b`,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true },
    });
    const offer = await prisma.merchantProduct.create({
      data: {
        availability: OfferAvailability.IN_STOCK,
        currency: 'BRL',
        merchantId: merchant.id,
        merchantSku: 'SKU-A',
        price: new Prisma.Decimal(100),
        productId: productA.id,
        sourceUpdatedAt: new Date(),
        stockQuantity: 5,
      },
      select: { id: true },
    });
    fixture = {
      merchantId: merchant.id,
      offerId: offer.id,
      productAId: productA.id,
      productBId: productB.id,
    };
  });

  afterAll(async () => {
    if (!prisma) return;
    const merchantFilter = {
      merchantProduct: {
        merchant: { slug: { startsWith: 'import-test-' } },
      },
    };
    await prisma.priceHistory.deleteMany({ where: merchantFilter });
    await prisma.customerReview.deleteMany({ where: merchantFilter });
    await prisma.import.deleteMany({
      where: { merchant: { slug: { startsWith: 'import-test-' } } },
    });
    await prisma.merchantProduct.deleteMany({
      where: { merchant: { slug: { startsWith: 'import-test-' } } },
    });
    await prisma.product.deleteMany({
      where: { slug: { startsWith: 'import-test-' } },
    });
    await prisma.merchant.deleteMany({
      where: { slug: { startsWith: 'import-test-' } },
    });
    await prisma.brand.deleteMany({
      where: { slug: { startsWith: 'import-test-' } },
    });
    await prisma.category.deleteMany({
      where: { slug: { startsWith: 'import-test-' } },
    });
    await prisma.$disconnect();
  });

  async function stagedImport(input: {
    action: ImportAction;
    currency?: string;
    merchantProductId?: string | null;
    oldCurrency?: string | null;
    oldPrice?: string | null;
    price: string;
    productId?: string;
    status?: ImportRowStatus;
    warning?: string;
  }): Promise<string> {
    const productId = input.productId ?? fixture.productAId;
    const status = input.status ?? ImportRowStatus.VALID;
    const created = await prisma.import.create({
      data: {
        actorId: 'integration-test',
        commitKey: `integration:${randomUUID()}`,
        merchantId: fixture.merchantId,
        originalFilename: 'fixture.csv',
        previewedAt: new Date(),
        sourceType: ImportSource.CSV,
        status: ImportStatus.READY,
        summary: {
          committable: input.action === IMPORT_ACTIONS.UNCHANGED ? 0 : 1,
          invalid: 0,
          inventoryChanges: 0,
          newOffers: input.action === IMPORT_ACTIONS.NEW_OFFER ? 1 : 0,
          priceChanges: input.action === IMPORT_ACTIONS.PRICE_CHANGE ? 1 : 0,
          totalRows: 1,
          unchanged: input.action === IMPORT_ACTIONS.UNCHANGED ? 1 : 0,
          warnings: status === ImportRowStatus.WARNING ? 1 : 0,
        },
        rows: {
          create: {
            merchantProductId:
              input.merchantProductId === undefined
                ? fixture.offerId
                : input.merchantProductId,
            matchedProductId: productId,
            matchMethod: MatchMethod.MERCHANT_SKU,
            normalizedData: {
              action: input.action,
              availability: OfferAvailability.IN_STOCK,
              barcode: null,
              brand: null,
              currency: input.currency ?? 'BRL',
              currentCurrency:
                input.oldCurrency === undefined ? 'BRL' : input.oldCurrency,
              currentPrice: input.oldPrice === undefined ? '100' : input.oldPrice,
              merchantSku: `SKU-${productId.slice(0, 8)}`,
              model: null,
              price: input.price,
              productName: 'Fixture product',
              stock: 5,
            },
            proposedAvailability: OfferAvailability.IN_STOCK,
            proposedCurrency: input.currency ?? 'BRL',
            proposedPrice: new Prisma.Decimal(input.price),
            proposedStock: 5,
            rawData: {},
            sourceRowNumber: 2,
            status,
            warnings: input.warning ? [input.warning] : [],
          },
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  it('serializes overlapping imports and preserves the price history chain', async () => {
    const firstId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      price: '150',
    });
    const secondId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      price: '200',
    });

    const outcomes = await Promise.allSettled([
      commitService.commit(firstId, { confirmWarnings: false }),
      commitService.commit(secondId, { confirmWarnings: false }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const firstHistory = await prisma.priceHistory.findFirstOrThrow({
      where: { merchantProductId: fixture.offerId },
      orderBy: { changedAt: 'asc' },
    });
    const currentOffer = await prisma.merchantProduct.findUniqueOrThrow({
      where: { id: fixture.offerId },
      select: { price: true },
    });
    expect(firstHistory.oldPrice?.toString()).toBe('100');
    expect(firstHistory.newPrice.toString()).toBe(currentOffer.price.toString());

    const finalPrice = currentOffer.price.equals(150) ? '200' : '150';
    const refreshedId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      oldPrice: currentOffer.price.toString(),
      price: finalPrice,
    });
    await commitService.commit(refreshedId, { confirmWarnings: false });
    const history = await prisma.priceHistory.findMany({
      where: { merchantProductId: fixture.offerId },
      orderBy: { changedAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    expect(history[1]?.oldPrice?.toString()).toBe(history[0]?.newPrice.toString());
  });

  it('does not let cancel overwrite a committed status after waiting on the row lock', async () => {
    const importId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      price: '150',
    });
    let releaseTransition: (() => void) | undefined;
    let transitionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      transitionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    const transition = prisma.$transaction(async (transaction) => {
      await transaction.import.update({
        where: { id: importId },
        data: { status: ImportStatus.VALIDATING },
      });
      transitionStarted?.();
      await release;
      await transaction.import.update({
        where: { id: importId },
        data: { committedAt: new Date(), status: ImportStatus.COMMITTED },
      });
    });
    await started;
    const cancellation = importsService.cancel(importId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseTransition?.();

    await transition;
    await expect(cancellation).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.import.findUniqueOrThrow({ where: { id: importId } }),
    ).resolves.toMatchObject({ status: ImportStatus.COMMITTED });
  });

  it('keeps an unchanged deactivated offer inactive', async () => {
    await prisma.merchantProduct.update({
      where: { id: fixture.offerId },
      data: { active: false },
    });
    const importId = await stagedImport({
      action: IMPORT_ACTIONS.UNCHANGED,
      price: '100',
    });

    await commitService.commit(importId, { confirmWarnings: false });

    await expect(
      prisma.merchantProduct.findUniqueOrThrow({ where: { id: fixture.offerId } }),
    ).resolves.toMatchObject({ active: false });
  });

  it('records both currencies when an offer currency changes', async () => {
    const importId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      currency: 'USD',
      price: '100',
      status: ImportRowStatus.WARNING,
      warning: 'Currency changes from BRL to USD.',
    });

    await commitService.commit(importId, { confirmWarnings: true });

    await expect(
      prisma.priceHistory.findFirstOrThrow({ where: { importId } }),
    ).resolves.toMatchObject({
      currency: 'USD',
      oldCurrency: 'BRL',
      oldPrice: new Prisma.Decimal(100),
      newPrice: new Prisma.Decimal(100),
    });
  });

  it('requires warning acknowledgement and remains idempotent after commit', async () => {
    const importId = await stagedImport({
      action: IMPORT_ACTIONS.PRICE_CHANGE,
      price: '10',
      status: ImportRowStatus.WARNING,
      warning: 'Price changes by 90%; verify before committing.',
    });

    await expect(
      commitService.commit(importId, { confirmWarnings: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    await commitService.commit(importId, { confirmWarnings: true });
    await commitService.commit(importId, { confirmWarnings: true });

    await expect(prisma.priceHistory.count({ where: { importId } })).resolves.toBe(1);
  });

  it('blocks a row when SKU and barcode resolve to different products', async () => {
    const productB = await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productBId },
      select: { barcode: true },
    });
    const csv = `merchantSku,productName,barcode,price,currency,stock\nSKU-A,Wrong match,${productB.barcode},100,BRL,5\n`;

    const importId = await stagingService.stageCsv(
      { merchantId: fixture.merchantId },
      {
        buffer: Buffer.from(csv),
        mimetype: 'text/csv',
        originalname: 'mismatch.csv',
        size: Buffer.byteLength(csv),
      },
    );
    const detail = await importsService.detail(importId);

    expect(detail.rows[0]).toMatchObject({
      action: IMPORT_ACTIONS.BLOCKED,
      status: ImportRowStatus.INVALID,
    });
  });

  it('blocks two rows that resolve to the same canonical product', async () => {
    const productA = await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productAId },
      select: { barcode: true },
    });
    const csv = `merchantSku,productName,barcode,price,currency,stock\nSKU-A,First,${productA.barcode},100,BRL,5\nSKU-NEW,Second,${productA.barcode},110,BRL,5\n`;

    const importId = await stagingService.stageCsv(
      { merchantId: fixture.merchantId },
      {
        buffer: Buffer.from(csv),
        mimetype: 'text/csv',
        originalname: 'duplicates.csv',
        size: Buffer.byteLength(csv),
      },
    );
    const detail = await importsService.detail(importId);

    expect(detail.rows).toHaveLength(2);
    expect(
      detail.rows.every((row) => row.status === ImportRowStatus.INVALID),
    ).toBe(true);
    expect(
      detail.rows.every((row) => row.action === IMPORT_ACTIONS.BLOCKED),
    ).toBe(true);
  });
});
