import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import { ImportTemplateService } from '../src/imports/import-template.service';
import { ImportStagingService } from '../src/imports/import-staging.service';
import { ImportCommitService } from '../src/imports/import-commit.service';
import { ImportsService } from '../src/imports/imports.service';
import {
  OfferQueryDto,
  type AdminOfferDto,
  type CreateMerchantOfferDto,
  type UpdateMerchantOfferDto,
} from '../src/merchants/merchant-offers.dto';
import { Workbook } from 'exceljs';
import { Readable } from 'node:stream';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const prefix = `merchant-ops-${randomUUID()}`;

run('merchant offers and XLSX integration', () => {
  let prisma: PrismaService;
  let offers: MerchantOffersService;
  let templates: ImportTemplateService;
  let staging: ImportStagingService;
  let commit: ImportCommitService;
  let imports: ImportsService;
  let merchantId: string;
  let otherMerchantId: string;
  let productId: string;
  let categoryId: string;
  let offer: AdminOfferDto;

  beforeAll(async () => {
    const config = new ConfigService({
      DATABASE_URL: databaseUrl,
      IMPORT_SUPPORTED_CURRENCIES: 'BRL,USD,PYG',
    });
    prisma = new PrismaService(config);
    await prisma.$connect();
    offers = new MerchantOffersService(prisma, config);
    templates = new ImportTemplateService(prisma);
    staging = new ImportStagingService(prisma, config);
    commit = new ImportCommitService(prisma);
    imports = new ImportsService(prisma);
    const category = await prisma.category.create({
      data: { name: prefix, slug: prefix },
    });
    categoryId = category.id;
    const brand = await prisma.brand.create({
      data: { name: prefix, slug: prefix },
    });
    const product = await prisma.product.create({
      data: {
        name: prefix,
        slug: prefix,
        categoryId,
        brandId: brand.id,
        barcode: `00${randomUUID().replaceAll('-', '').slice(0, 25)}`,
      },
    });
    productId = product.id;
  });

  function createInput(
    overrides: Partial<CreateMerchantOfferDto> = {},
  ): CreateMerchantOfferDto {
    return {
      productId,
      merchantSku: 'SKU-001',
      price: '100.00',
      currency: 'BRL',
      stock: '5',
      availability: 'IN_STOCK',
      confirmed: true,
      confirmWarnings: false,
      ...overrides,
    };
  }
  function updateInput(current = offer): UpdateMerchantOfferDto {
    return {
      merchantSku: current.merchantSku,
      price: current.price.amount,
      currency: current.price.currency,
      stock: String(current.stockQuantity ?? ''),
      availability: current.availability,
      active: current.active,
      confirmed: true,
      confirmWarnings: false,
      expectedUpdatedAt: current.updatedAt,
    };
  }

  beforeEach(async () => {
    const merchants = await Promise.all(
      [1, 2].map((number) =>
        prisma.merchant.create({
          data: {
            name: `${prefix}-${number}`,
            slug: `${prefix}-${number}-${randomUUID()}`,
          },
        }),
      ),
    );
    merchantId = merchants[0].id;
    otherMerchantId = merchants[1].id;
    offer = await offers.create(
      merchantId,
      createInput(),
      'firebase:creator-uid',
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    const merchantWhere = { slug: { startsWith: prefix } };
    await prisma.priceHistory.deleteMany({
      where: { merchantProduct: { merchant: merchantWhere } },
    });
    await prisma.import.deleteMany({ where: { merchant: merchantWhere } });
    await prisma.merchantProduct.deleteMany({
      where: { merchant: merchantWhere },
    });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.merchant.deleteMany({ where: merchantWhere });
    await prisma.brand.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it('creates decimal prices with an initial MANUAL history entry and rejects duplicate offers', async () => {
    expect(offer.price).toEqual({ amount: '100.00', currency: 'BRL' });
    await expect(
      offers.create(merchantId, createInput()),
    ).rejects.toBeInstanceOf(ConflictException);
    const history = await prisma.priceHistory.findMany({
      where: { merchantProductId: offer.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      source: 'MANUAL',
      oldPrice: null,
      oldCurrency: null,
      actorId: 'firebase:creator-uid',
    });
  });

  it('carries numeric SKU warnings through preview and blocks commit until explicitly acknowledged', async () => {
    await offers.update(merchantId, offer.id, {
      ...updateInput(),
      merchantSku: '123',
    });
    const file = await templates.download({ format: 'xlsx', merchantId });
    const book = new Workbook();
    await book.xlsx.read(Readable.from(file.buffer));
    const sheet = book.getWorksheet('Catalog')!;
    sheet.getCell('A2').value = 123;
    sheet.getCell('I2').value = true;
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    const upload = {
      originalname: 'numeric-sku.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
      size: buffer.length,
    };
    const staged = await staging.stageXlsx({ merchantId }, upload);
    const preview = await imports.detail(staged);
    expect(preview.summary.invalid).toBe(0);
    expect(preview.summary.warnings).toBe(1);
    expect(preview.rows[0].warnings.join(' ')).toContain('leading zeros');
    await expect(
      commit.commit(staged, { confirmWarnings: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await imports.detail(staged)).status).toBe('READY');
    await commit.commit(staged, { confirmWarnings: true });
    expect((await imports.detail(staged)).status).toBe('COMMITTED');
    expect((await offers.detail(merchantId, offer.id)).merchantSku).toBe('123');
  });

  it('adds an entirely new product and first offer atomically; duplicate SKU rolls everything back', async () => {
    const input = createInput({
      productId: undefined,
      merchantSku: 'NEW-SKU',
      newProduct: {
        name: `New product ${randomUUID()}`,
        brand: prefix,
        categoryId,
        barcode: '00' + randomUUID().replaceAll('-', '').slice(0, 25),
      },
    });
    const added = await offers.create(merchantId, input);
    expect(added.product.barcode).toBe(
      input.newProduct?.barcode?.toUpperCase(),
    );
    const productCount = await prisma.product.count({ where: { categoryId } });
    await expect(
      offers.create(
        merchantId,
        createInput({
          productId: undefined,
          newProduct: {
            name: `Rollback ${randomUUID()}`,
            brand: prefix,
            categoryId,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.product.count({ where: { categoryId } })).toBe(
      productCount,
    );
  });

  it('validates stock and prices and requires explicit confirmation', async () => {
    await expect(
      offers.update(merchantId, offer.id, {
        ...updateInput(),
        confirmed: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      offers.update(merchantId, offer.id, { ...updateInput(), price: '0' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      offers.update(merchantId, offer.id, {
        ...updateInput(),
        stock: '0',
        availability: 'IN_STOCK',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await offers.detail(merchantId, offer.id)).price.amount).toBe(
      '100.00',
    );
  });

  it('requires acknowledgement for currency and large price changes and records truthful history', async () => {
    await expect(
      offers.update(merchantId, offer.id, {
        ...updateInput(),
        currency: 'USD',
        price: '200',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const changed = await offers.update(
      merchantId,
      offer.id,
      {
        ...updateInput(),
        currency: 'USD',
        price: '200',
        confirmWarnings: true,
      },
      'firebase:editor-uid',
    );
    expect(changed.price).toEqual({ amount: '200.00', currency: 'USD' });
    const history = await prisma.priceHistory.findFirstOrThrow({
      where: { merchantProductId: offer.id, oldCurrency: 'BRL' },
    });
    expect(history.currency).toBe('USD');
    expect(history.actorId).toBe('firebase:editor-uid');
    expect(history.oldPrice?.toString()).toBe('100');
    expect(history.newPrice.toString()).toBe('200');
  });

  it('rejects stale manual edits and does not add history for stock-only changes', async () => {
    const changed = await offers.update(merchantId, offer.id, {
      ...updateInput(),
      stock: '8',
    });
    await expect(
      offers.update(merchantId, offer.id, { ...updateInput(), price: '110' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(changed.stockQuantity).toBe(8);
    expect(
      await prisma.priceHistory.count({
        where: { merchantProductId: offer.id },
      }),
    ).toBe(1);
  });

  it('removes and restores only the selected merchant offer, retaining history and other merchants', async () => {
    const other = await offers.create(otherMerchantId, createInput());
    const removed = await offers.remove(merchantId, offer.id, {
      expectedUpdatedAt: offer.updatedAt,
      confirmed: true,
    });
    expect(removed.active).toBe(false);
    expect(
      (
        await offers.list(
          merchantId,
          Object.assign(new OfferQueryDto(), { active: true }),
        )
      ).items,
    ).toHaveLength(0);
    expect((await offers.detail(otherMerchantId, other.id)).active).toBe(true);
    expect(
      await prisma.priceHistory.count({
        where: { merchantProductId: offer.id },
      }),
    ).toBe(1);
    const restored = await offers.update(merchantId, offer.id, {
      ...updateInput(removed),
      active: true,
    });
    expect(restored.active).toBe(true);
  });

  it('rejects mismatched merchant and offer IDs on every individual offer operation', async () => {
    await expect(
      offers.detail(otherMerchantId, offer.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      offers.update(otherMerchantId, offer.id, updateInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      offers.remove(otherMerchantId, offer.id, {
        confirmed: true,
        expectedUpdatedAt: offer.updatedAt,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await offers.detail(merchantId, offer.id)).active).toBe(true);
  });

  async function preview(
    format: 'csv' | 'xlsx' = 'xlsx',
    price = '110.00',
  ): Promise<string> {
    const template = await templates.download({ format, merchantId });
    let buffer = template.buffer;
    if (format === 'xlsx') {
      const book = new Workbook();
      await book.xlsx.read(Readable.from(buffer));
      book.worksheets[0].getCell('F2').value = price;
      buffer = Buffer.from(await book.xlsx.writeBuffer());
    } else {
      buffer = Buffer.from(
        buffer.toString('utf8').replace('"100.00"', `"${price}"`),
      );
    }
    const file = {
      originalname: template.filename,
      buffer,
      size: buffer.length,
      mimetype: template.contentType,
    };
    return format === 'xlsx'
      ? await staging.stageXlsx({ merchantId }, file, 'firebase:uploader-uid')
      : await staging.stageCsv({ merchantId }, file, 'firebase:uploader-uid');
  }

  it.each(['csv', 'xlsx'] as const)(
    'round-trips the merchant %s template through preview and idempotent commit',
    async (format) => {
      const id = await preview(format);
      expect((await imports.detail(id)).summary).toMatchObject({
        totalRows: 1,
        priceChanges: 1,
        invalid: 0,
      });
      expect((await offers.detail(merchantId, offer.id)).price.amount).toBe(
        '100.00',
      );
      expect(
        (await prisma.import.findUniqueOrThrow({ where: { id } })).actorId,
      ).toBe('firebase:uploader-uid');
      await commit.commit(
        id,
        { confirmWarnings: false },
        'firebase:committer-uid',
      );
      await commit.commit(
        id,
        { confirmWarnings: false },
        'firebase:another-admin',
      );
      const history = await prisma.priceHistory.findMany({
        where: { importId: id },
      });
      expect(history).toHaveLength(1);
      expect(history[0].source).toBe(format.toUpperCase());
      expect(history[0].actorId).toBe('firebase:committer-uid');
      expect((await offers.detail(merchantId, offer.id)).price.amount).toBe(
        '110.00',
      );
    },
  );

  it('rejects a preview after an inventory edit or removal', async () => {
    const first = await preview();
    const changed = await offers.update(merchantId, offer.id, {
      ...updateInput(),
      stock: '7',
    });
    await expect(
      commit.commit(first, { confirmWarnings: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    const second = await preview();
    await offers.remove(merchantId, offer.id, {
      confirmed: true,
      expectedUpdatedAt: changed.updatedAt,
    });
    await expect(
      commit.commit(second, { confirmWarnings: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await offers.detail(merchantId, offer.id)).active).toBe(false);
  });

  it('serializes manual updates and import commits so only one stale snapshot succeeds', async () => {
    const id = await preview();
    const outcomes = await Promise.allSettled([
      commit.commit(id, { confirmWarnings: false }),
      offers.update(merchantId, offer.id, { ...updateInput(), price: '120' }),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await prisma.priceHistory.count({
        where: { merchantProductId: offer.id },
      }),
    ).toBe(2);
  });

  it('blocks a supplied barcode that contradicts an existing merchant SKU', async () => {
    const buffer = Buffer.from(
      'merchantSku,productName,barcode,price,currency,stock,availability\nSKU-001,Test,0000000000000,110.00,BRL,5,IN_STOCK',
    );
    const id = await staging.stageCsv(
      { merchantId },
      {
        originalname: 'mismatch.csv',
        buffer,
        size: buffer.length,
        mimetype: 'text/csv',
      },
    );
    expect((await imports.detail(id)).summary.invalid).toBe(1);
    await expect(
      commit.commit(id, { confirmWarnings: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await offers.detail(merchantId, offer.id)).price.amount).toBe(
      '100.00',
    );
  });

  it('blocks duplicate canonical barcodes and inactive merchants', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    await expect(
      offers.create(
        otherMerchantId,
        createInput({
          productId: undefined,
          newProduct: {
            name: 'Duplicate',
            brand: prefix,
            categoryId,
            barcode: product.barcode ?? '',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { active: false },
    });
    await expect(
      offers.update(merchantId, offer.id, updateInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
