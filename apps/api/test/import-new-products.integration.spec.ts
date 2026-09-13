import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { PrismaService } from '../src/database/prisma.service';
import { ImportStagingService } from '../src/imports/import-staging.service';
import { ImportCommitService } from '../src/imports/import-commit.service';
import { ImportsService } from '../src/imports/imports.service';
import type { AdminImportDetailDto } from '../src/imports/imports.dto';
import {
  ImportTemplateService,
  csvCell,
} from '../src/imports/import-template.service';
import { MerchantOffersService } from '../src/merchants/merchant-offers.service';
import type { CreateMerchantOfferDto } from '../src/merchants/merchant-offers.dto';
import { CANONICAL_IMPORT_FIELDS } from '../src/imports/import-normalization';
import {
  catalogSlug,
  NEW_PRODUCT_BARCODE_ERROR,
} from '../src/imports/import-catalog';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const prefix = `new-import-${randomUUID()}`;
const barcode = (): string => `789${randomInt(1_000_000_000, 10_000_000_000)}`;

run('new catalog products through imports', () => {
  let prisma: PrismaService;
  let staging: ImportStagingService;
  let commit: ImportCommitService;
  let imports: ImportsService;
  let manual: MerchantOffersService;
  let merchantId: string;
  let category: { id: string; name: string };
  let serial = 0;

  beforeAll(async () => {
    const config = new ConfigService({ DATABASE_URL: databaseUrl });
    prisma = new PrismaService(config);
    await prisma.$connect();
    staging = new ImportStagingService(prisma, config);
    commit = new ImportCommitService(prisma);
    imports = new ImportsService(prisma);
    manual = new MerchantOffersService(prisma, config);
    category = await prisma.category.create({
      data: { name: prefix, slug: prefix },
      select: { id: true, name: true },
    });
  });
  beforeEach(async () => {
    serial++;
    const merchant = await prisma.merchant.create({
      data: { name: prefix, slug: `${prefix}-${serial}` },
    });
    merchantId = merchant.id;
  });
  afterAll(async () => {
    if (!prisma) return;
    const merchant = { slug: { startsWith: prefix } };
    await prisma.priceHistory.deleteMany({
      where: { merchantProduct: { merchant } },
    });
    await prisma.import.deleteMany({ where: { merchant } });
    await prisma.merchantProduct.deleteMany({ where: { merchant } });
    await prisma.product.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.merchant.deleteMany({ where: merchant });
    await prisma.brand.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.category.deleteMany({ where: { id: category.id } });
    await prisma.$disconnect();
  });
  function row(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      merchantSku: '001',
      productName: `${prefix} product ${serial}`,
      brand: `${prefix} brand`,
      model: '128 GB black',
      barcode: '',
      price: '100.00',
      currency: 'BRL',
      stock: '4',
      availability: 'IN_STOCK',
      category: category.name,
      ...overrides,
    };
  }
  async function stage(
    rows: Record<string, string>[],
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<AdminImportDetailDto> {
    const values = rows.map((data) =>
      CANONICAL_IMPORT_FIELDS.map((key) => data[key] ?? ''),
    );
    let buffer: Buffer;
    if (format === 'xlsx') {
      const book = new Workbook();
      const sheet = book.addWorksheet('Catalog');
      sheet.addRow([...CANONICAL_IMPORT_FIELDS]);
      sheet.addRows(values);
      buffer = Buffer.from(await book.xlsx.writeBuffer());
    } else
      buffer = Buffer.from(
        [
          CANONICAL_IMPORT_FIELDS.join(','),
          ...values.map((data) => data.map(csvCell).join(',')),
        ].join('\n'),
      );
    const file = {
      originalname: `test.${format}`,
      mimetype: 'application/octet-stream',
      buffer,
      size: buffer.length,
    };
    const id =
      format === 'xlsx'
        ? await staging.stageXlsx({ merchantId }, file)
        : await staging.stageCsv({ merchantId }, file);
    return await imports.detail(id);
  }
  async function confirm(preview: AdminImportDetailDto): Promise<void> {
    await commit.commit(
      preview.id,
      {
        confirmWarnings: true,
        confirmNewProducts: true,
        expectedPreviewToken: preview.previewToken,
      },
      'firebase:test-admin',
    );
  }
  function manualInput(data: Record<string, string>): CreateMerchantOfferDto {
    return {
      merchantSku: data.merchantSku,
      price: data.price,
      currency: data.currency,
      stock: data.stock,
      availability: 'IN_STOCK' as const,
      confirmed: true,
      confirmWarnings: true,
      newProduct: {
        name: data.productName,
        brand: data.brand,
        model: data.model,
        barcode: data.barcode,
        categoryId: category.id,
      },
    };
  }

  it('reuses a brand by slug for preview, import and manual creation', async () => {
    const brandName = `${prefix} Coca-Cola ${serial}`;
    const brand = await prisma.brand.create({
      data: { name: brandName, slug: catalogSlug(brandName) },
    });
    const draft = row({
      brand: brandName.replace('Coca-Cola', 'Coca Cola'),
      model: 'A3090',
    });
    const preview = await stage([draft]);
    expect(preview.summary.newProducts).toBe(1);
    await confirm(preview);
    const imported = await prisma.product.findFirstOrThrow({
      where: { name: draft.productName },
    });
    expect(imported.brandId).toBe(brand.id);
    const added = await manual.create(
      merchantId,
      manualInput({
        ...draft,
        merchantSku: 'MANUAL',
        productName: `${draft.productName} other`,
      }),
    );
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: added.product.id },
        })
      ).brandId,
    ).toBe(brand.id);
    expect(await prisma.brand.count({ where: { slug: brand.slug } })).toBe(1);
    // A spelling alias and differently cased model must not bypass duplicate detection.
    const duplicate = {
      ...draft,
      brand: brandName,
      merchantSku: 'DUPLICATE',
      model: 'a3090',
    };
    expect((await stage([duplicate])).rows[0].errors.join(' ')).toContain(
      'names are not automatic matches',
    );
    await expect(
      manual.create(merchantId, manualInput(duplicate)),
    ).rejects.toThrow('already exist');
  });

  it('blocks duplicate variants under brand spelling aliases in the same file', async () => {
    const brandName = `${prefix} Coca-Cola ${serial}`;
    const draft = row({ brand: brandName, model: 'A3090' });
    const preview = await stage([
      draft,
      {
        ...draft,
        merchantSku: 'B',
        brand: brandName.replace('Coca-Cola', 'Coca Cola'),
        model: 'a3090',
      },
    ]);
    expect(preview.summary).toMatchObject({ newProducts: 0, invalid: 2 });
  });

  for (const state of ['inactive', 'ambiguous'] as const) {
    it(`rejects ${state} brand aliases at preview, commit and manual entry`, async () => {
      const brandName = `${prefix} Coca-Cola ${serial}`;
      const draft = row({ brand: brandName.replace('Coca-Cola', 'Coca Cola') });
      const preview = await stage([draft]);
      await prisma.brand.create({
        data: {
          name: brandName,
          slug: catalogSlug(brandName),
          active: state !== 'inactive',
        },
      });
      if (state === 'ambiguous')
        await prisma.brand.create({
          data: { name: draft.brand, slug: `${catalogSlug(brandName)}-legacy` },
        });
      expect((await stage([draft])).rows[0].errors.join(' ')).toContain(
        'brand is inactive or ambiguous',
      );
      await expect(confirm(preview)).rejects.toThrow(
        'brand is inactive or ambiguous',
      );
      await expect(
        manual.create(merchantId, manualInput(draft)),
      ).rejects.toThrow('brand is inactive or ambiguous');
      expect(
        await prisma.product.count({ where: { name: draft.productName } }),
      ).toBe(0);
    });
  }

  it('rejects a newly conflicting variant at commit despite brand spelling and model case changes', async () => {
    const brandName = `${prefix} Coca-Cola ${serial}`;
    const draft = row({
      brand: brandName.replace('Coca-Cola', 'Coca Cola'),
      model: 'a3090',
    });
    const preview = await stage([draft]);
    await manual.create(
      merchantId,
      manualInput({
        ...draft,
        merchantSku: 'MANUAL',
        brand: brandName,
        model: 'A3090',
      }),
    );
    await expect(confirm(preview)).rejects.toThrow('now exists in the catalog');
    expect(
      await prisma.product.count({ where: { name: draft.productName } }),
    ).toBe(1);
  });

  for (const format of ['csv', 'xlsx'] as const) {
    it(`blocks fake new barcodes in ${format}, while blank and supported digit lengths create products`, async () => {
      const invalid = [
        '0000000000000',
        '11111111',
        '222222222222',
        '33333333333333',
        'A BARCODE',
        '123456789',
        '123456789012345',
      ];
      const valid = [
        '',
        `12${String(serial).padStart(6, '0')}`,
        `01${String(serial).padStart(10, '0')}`,
        barcode(),
        `0${barcode()}`,
      ];
      const drafts = [...invalid, ...valid].map((value, index) =>
        row({
          barcode: value,
          merchantSku: `BARCODE-${index}`,
          productName: `${prefix} barcode ${serial} ${index}`,
        }),
      );
      const preview = await stage(drafts, format);
      expect(preview.summary).toMatchObject({
        newProducts: valid.length,
        invalid: invalid.length,
      });
      for (const row of preview.rows.slice(0, invalid.length))
        expect(row.errors).toContain(NEW_PRODUCT_BARCODE_ERROR);
      for (const draft of drafts.slice(0, invalid.length))
        await expect(
          manual.create(merchantId, manualInput(draft)),
        ).rejects.toThrow(NEW_PRODUCT_BARCODE_ERROR);
      await confirm(preview);
      expect(
        await prisma.merchantProduct.count({ where: { merchantId } }),
      ).toBe(valid.length);
      expect(
        await prisma.product.count({ where: { barcode: { in: invalid } } }),
      ).toBe(0);
    });
  }

  it('rejects a placeholder in an older stored new-product preview at commit', async () => {
    const draft = row();
    const preview = await stage([draft]);
    const stored = await prisma.importRow.findUniqueOrThrow({
      where: { id: preview.rows[0].id },
    });
    await prisma.importRow.update({
      where: { id: stored.id },
      data: {
        normalizedData: {
          ...(stored.normalizedData as Record<string, string>),
          barcode: '0000000000000',
        },
      },
    });
    await expect(confirm(await imports.detail(preview.id))).rejects.toThrow(
      NEW_PRODUCT_BARCODE_ERROR,
    );
    expect(
      await prisma.product.count({ where: { name: draft.productName } }),
    ).toBe(0);
    expect((await imports.detail(preview.id)).status).toBe('READY');
  });

  for (const format of ['csv', 'xlsx'] as const) {
    it(`creates new products and listings only after explicit ${format} confirmation, with idempotency and unchanged reimport`, async () => {
      const source = row({ category: '' });
      const beforeProducts = await prisma.product.count();
      const beforeBrands = await prisma.brand.count();
      const preview = await stage([source], format);
      expect(preview.summary).toMatchObject({
        newProducts: 1,
        newOffers: 0,
        invalid: 0,
      });
      expect(preview.rows[0]).toMatchObject({
        action: 'NEW_PRODUCT',
        brand: source.brand,
        matchedProduct: null,
      });
      expect(await prisma.product.count()).toBe(beforeProducts);
      expect(await prisma.brand.count()).toBe(beforeBrands);
      await expect(
        commit.commit(preview.id, { confirmWarnings: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        commit.commit(preview.id, {
          confirmWarnings: false,
          confirmNewProducts: true,
          expectedPreviewToken: preview.previewToken,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await confirm(preview);
      await confirm(preview);
      expect(await prisma.product.count()).toBe(beforeProducts + 1);
      const offers = await prisma.merchantProduct.findMany({
        where: { merchantId },
        include: {
          product: { include: { category: true } },
          priceHistory: true,
        },
      });
      expect(offers).toHaveLength(1);
      expect(offers[0].merchantSku).toBe('001');
      expect(offers[0].product.category.slug).toBe('uncategorized');
      expect(offers[0].priceHistory).toHaveLength(1);
      expect(offers[0].priceHistory[0]).toMatchObject({
        oldPrice: null,
        actorId: 'firebase:test-admin',
        source: format.toUpperCase(),
      });
      expect(
        (await imports.detail(preview.id)).rows[0].matchedProduct?.id,
      ).toBe(offers[0].productId);
      const again = await stage([source], format);
      expect(again.rows[0].action).toBe('UNCHANGED');
      await confirm(again);
      expect(
        await prisma.priceHistory.count({
          where: { merchantProductId: offers[0].id },
        }),
      ).toBe(1);
    });
  }
  it('cancels without creating catalog records', async () => {
    const source = row();
    const preview = await stage([source]);
    await imports.cancel(preview.id);
    await expect(confirm(preview)).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.product.count({ where: { name: source.productName } }),
    ).toBe(0);
  });
  it('blocks missing brands and duplicate barcodes without blocking valid new rows', async () => {
    const preview = await stage([
      row({ merchantSku: 'A', brand: '' }),
      row({
        merchantSku: 'B',
        barcode: 'DUPLICATE',
        productName: `${prefix} duplicate B`,
      }),
      row({
        merchantSku: 'C',
        barcode: 'DUPLICATE',
        productName: `${prefix} duplicate C`,
      }),
      row({ merchantSku: 'D', productName: `${prefix} valid` }),
    ]);
    expect(preview.summary).toMatchObject({ newProducts: 1, invalid: 3 });
    await confirm(preview);
    expect(await prisma.merchantProduct.count({ where: { merchantId } })).toBe(
      1,
    );
  });
  it('does not automatically merge names and blocks inactive or unknown references', async () => {
    const source = row({ barcode: barcode() });
    await confirm(await stage([source]));
    const other = await prisma.merchant.create({
      data: { name: prefix, slug: `${prefix}-other-${serial}` },
    });
    merchantId = other.id;
    const sameName = await stage([{ ...source, barcode: '' }]);
    expect(sameName.rows[0].action).toBe('BLOCKED');
    expect(sameName.rows[0].errors.join(' ')).toContain(
      'names are not automatic matches',
    );
    const exactBarcode = await stage([source]);
    expect(exactBarcode.rows[0].action).toBe('NEW_OFFER');
    await confirm(exactBarcode);
    const unknownCategory = await stage([
      row({
        merchantSku: 'OTHER',
        category: 'missing-category',
        productName: `${prefix} unknown category`,
      }),
    ]);
    expect(unknownCategory.summary.invalid).toBe(1);
    await prisma.product.update({
      where: { barcode: source.barcode.toUpperCase() },
      data: { status: 'INACTIVE' },
    });
    expect((await stage([source])).summary.invalid).toBe(1);
  });
  it('rejects stale preview confirmation if any stored row changed', async () => {
    const preview = await stage([row()]);
    const stored = await prisma.importRow.findUniqueOrThrow({
      where: { id: preview.rows[0].id },
    });
    // Even changes sharing the original millisecond must invalidate confirmation.
    await prisma.importRow.update({
      where: { id: stored.id },
      data: { proposedStock: 99, updatedAt: stored.updatedAt },
    });
    await expect(confirm(preview)).rejects.toThrow('preview changed');
    expect(await prisma.merchantProduct.count({ where: { merchantId } })).toBe(
      0,
    );
  });
  it('rolls back newly created products when a SKU becomes occupied after preview', async () => {
    const draft = row();
    const preview = await stage([draft]);
    await confirm(await stage([row({ productName: `${prefix} intervening` })]));
    await expect(confirm(preview)).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.product.count({ where: { name: draft.productName } }),
    ).toBe(0);
    expect((await imports.detail(preview.id)).status).toBe('READY');
  });
  it('serializes concurrent product creation and rejects the losing stale preview', async () => {
    const draft = row({ barcode: barcode() });
    const first = await stage([draft]);
    const second = await stage([draft]);
    const results = await Promise.allSettled([confirm(first), confirm(second)]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.product.count({ where: { name: draft.productName } }),
    ).toBe(1);
    expect(await prisma.merchantProduct.count({ where: { merchantId } })).toBe(
      1,
    );
  });
  it('shares creation locking with manual add and never silently attaches after preview', async () => {
    const draft = row({ barcode: barcode() });
    const preview = await stage([draft]);
    const results = await Promise.allSettled([
      confirm(preview),
      manual.create(merchantId, {
        merchantSku: 'MANUAL',
        price: '100',
        currency: 'BRL',
        stock: '4',
        availability: 'IN_STOCK',
        confirmed: true,
        confirmWarnings: true,
        newProduct: {
          name: draft.productName,
          brand: draft.brand,
          model: draft.model,
          barcode: draft.barcode,
          categoryId: category.id,
        },
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.product.count({ where: { name: draft.productName } }),
    ).toBe(1);
  });
  it('keeps exported current products compatible with both import formats', async () => {
    await confirm(await stage([row()]));
    const templates = new ImportTemplateService(prisma);
    for (const format of ['csv', 'xlsx'] as const) {
      const file = await templates.download({
        merchantId,
        format,
        locale: 'pt-BR',
      });
      const upload = {
        originalname: file.filename,
        mimetype: file.contentType,
        buffer: file.buffer,
        size: file.buffer.length,
      };
      const id =
        format === 'csv'
          ? await staging.stageCsv({ merchantId }, upload)
          : await staging.stageXlsx({ merchantId }, upload);
      expect((await imports.detail(id)).summary).toMatchObject({
        unchanged: 1,
        invalid: 0,
        newProducts: 0,
      });
    }
  });
  it('commits a full 500-row, 500-brand batch of new products atomically', async () => {
    const preview = await stage(
      Array.from({ length: 500 }, (_, index) =>
        row({
          merchantSku: `BATCH-${index}`,
          productName: `${prefix} batch-${index}`,
          brand: `${prefix} batch-brand-${index}`,
        }),
      ),
    );
    expect(preview.summary.newProducts).toBe(500);
    await confirm(preview);
    expect(await prisma.merchantProduct.count({ where: { merchantId } })).toBe(
      500,
    );
  }, 45000);

  if (process.env.IMPORT_REGRESSION_XLSX) {
    it('blocks the owner workbook placeholders; clearing only those barcodes allows nine new product proposals', async () => {
      const buffer = await readFile(
        process.env.IMPORT_REGRESSION_XLSX as string,
      );
      const id = await staging.stageXlsx(
        { merchantId },
        {
          originalname: 'test.xlsx',
          mimetype: 'application/octet-stream',
          size: buffer.length,
          buffer,
        },
      );
      const preview = await imports.detail(id);
      expect(preview.summary).toMatchObject({
        totalRows: 9,
        newProducts: 0,
        invalid: 9,
      });
      expect(
        preview.rows
          .filter((row) => row.status === 'INVALID')
          .map((row) => row.sourceRowNumber),
      ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const row of preview.rows)
        expect(row.errors).toContain(NEW_PRODUCT_BARCODE_ERROR);
      // Preserve the user file and avoid copying its data into the repository.
      await imports.cancel(id);
      const book = new Workbook();
      await book.xlsx.load(Uint8Array.from(buffer).buffer);
      const sheet = book.worksheets[0];
      const barcodeColumn = (sheet.getRow(1).values as unknown[]).indexOf(
        'barcode',
      );
      expect(barcodeColumn).toBeGreaterThan(0);
      for (let index = 2; index <= sheet.rowCount; index++)
        sheet.getCell(index, barcodeColumn).value = null;
      const correctedBuffer = Buffer.from(await book.xlsx.writeBuffer());
      const correctedId = await staging.stageXlsx(
        { merchantId },
        {
          originalname: 'test.xlsx',
          mimetype: 'application/octet-stream',
          buffer: correctedBuffer,
          size: correctedBuffer.length,
        },
      );
      expect((await imports.detail(correctedId)).summary).toMatchObject({
        totalRows: 9,
        newProducts: 9,
        invalid: 0,
      });
      await imports.cancel(correctedId);
    });
  }
});
