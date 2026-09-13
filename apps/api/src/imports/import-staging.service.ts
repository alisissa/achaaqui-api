import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  ImportRowStatus,
  ImportSource,
  ImportStatus,
  MatchMethod,
  OfferAvailability,
  Prisma,
  ProductStatus,
} from '../generated/prisma/client';
import { parseCsv, type ParsedCsvRow } from './csv-parser';
import { parseXlsx } from './xlsx-parser';
import { UploadCsvDto } from './imports.dto';
import {
  catalogText,
  catalogBrandWhere,
  catalogBrandMatches,
  productDraftKey,
  validNewProductBarcode,
  NEW_PRODUCT_BARCODE_ERROR,
  CATALOG_BRAND_ERROR,
} from './import-catalog';
import {
  normalizeImportRecord,
  normalizeIdentifier,
  type NormalizedImportRow,
} from './import-normalization';
import {
  emptyImportSummary,
  IMPORT_ACTIONS,
  type ImportAction,
  type ImportSummary,
  type StoredNormalizedRow,
} from './import-types';

export interface UploadedCsvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface ExistingOffer {
  id: string;
  merchantSku: string;
  productId: string;
  price: Prisma.Decimal;
  currency: string;
  availability: OfferAvailability;
  stockQuantity: number | null;
  updatedAt: Date;
  product: MatchedProduct;
}

interface MatchedProduct {
  id: string;
  name: string;
  barcode: string | null;
  status: ProductStatus;
}

interface StagedRow {
  source: ParsedCsvRow;
  normalized: NormalizedImportRow;
  stored: StoredNormalizedRow;
  errors: string[];
  warnings: string[];
  matchedProductId: string | null;
  merchantProductId: string | null;
  matchMethod: MatchMethod;
}

@Injectable()
export class ImportStagingService {
  private readonly supportedCurrencies: ReadonlySet<string>;
  private readonly suspiciousChangePercent: number;
  private readonly maxRows: number;
  private readonly maxFileBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.supportedCurrencies = new Set(
      configService
        .get<string>('IMPORT_SUPPORTED_CURRENCIES', 'BRL,USD,PYG')
        .split(','),
    );
    this.suspiciousChangePercent = configService.get<number>(
      'IMPORT_SUSPICIOUS_CHANGE_PERCENT',
      50,
    );
    this.maxRows = configService.get<number>('IMPORT_MAX_ROWS', 500);
    this.maxFileBytes = configService.get<number>(
      'IMPORT_MAX_FILE_BYTES',
      2_097_152,
    );
  }

  async stageCsv(
    input: UploadCsvDto,
    file: UploadedCsvFile | undefined,
    actorId = 'local-admin',
  ): Promise<string> {
    return await this.stage(input, file, ImportSource.CSV, actorId);
  }

  async stageXlsx(
    input: UploadCsvDto,
    file: UploadedCsvFile | undefined,
    actorId = 'local-admin',
  ): Promise<string> {
    return await this.stage(input, file, ImportSource.XLSX, actorId);
  }

  private async stage(
    input: UploadCsvDto,
    file: UploadedCsvFile | undefined,
    sourceType: 'CSV' | 'XLSX',
    actorId: string,
  ): Promise<string> {
    this.validateFile(file, sourceType);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchantId },
      select: { id: true, active: true },
    });
    if (!merchant || !merchant.active) {
      throw new NotFoundException('Active merchant not found.');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const commitKey = `import:${randomUUID()}`;

    const parsedRows =
      sourceType === ImportSource.XLSX
        ? await parseXlsx(file.buffer, this.maxRows)
        : parseCsv(file.buffer, this.maxRows);
    if (parsedRows.length === 0) {
      throw new BadRequestException('The file contains no data rows.');
    }
    if (parsedRows.length > this.maxRows) {
      throw new BadRequestException(
        `This first import version accepts up to ${this.maxRows} rows per file.`,
      );
    }

    const stagedRows = await this.matchRows(merchant.id, parsedRows);
    await this.validateNewProducts(stagedRows);
    this.markDuplicateProducts(stagedRows);
    const summary = this.summarize(stagedRows);
    const created = await this.prisma.import.create({
      data: {
        merchantId: merchant.id,
        sourceType,
        status: ImportStatus.READY,
        originalFilename: file.originalname,
        sourceReference: `sha256:${fileHash}`,
        mappingSnapshot: {
          version: 2,
          mode: `canonical-${sourceType.toLowerCase()}`,
        },
        summary: { ...summary },
        commitKey,
        actorId,
        previewedAt: new Date(),
        rows: {
          create: stagedRows.map((row) => ({
            sourceRowNumber: row.source.sourceRowNumber,
            rawData: row.source.rawData,
            normalizedData: { ...row.stored },
            matchedProductId: row.matchedProductId,
            merchantProductId: row.merchantProductId,
            matchMethod: row.matchMethod,
            matchConfidence:
              row.matchMethod === MatchMethod.NONE
                ? null
                : new Prisma.Decimal(1),
            proposedPrice: row.normalized.price
              ? new Prisma.Decimal(row.normalized.price)
              : null,
            proposedCurrency: row.normalized.currency,
            proposedStock: row.normalized.stock,
            proposedAvailability: row.normalized.availability,
            validationErrors: row.errors,
            warnings: row.warnings,
            status: this.rowStatus(row),
          })),
        },
      },
      select: { id: true },
    });

    return created.id;
  }

  private validateFile(
    file: UploadedCsvFile | undefined,
    sourceType: 'CSV' | 'XLSX',
  ): asserts file is UploadedCsvFile {
    if (!file) throw new BadRequestException('A file is required.');
    if (
      file.originalname.length > 260 ||
      !file.originalname.toLowerCase().endsWith(`.${sourceType.toLowerCase()}`)
    ) {
      throw new BadRequestException(
        `Select a .${sourceType.toLowerCase()} file with a filename under 261 characters.`,
      );
    }
    if (file.buffer.length <= 0 || file.buffer.length > this.maxFileBytes) {
      throw new BadRequestException(
        `File size must be between 1 byte and ${this.maxFileBytes} bytes.`,
      );
    }
  }

  private async matchRows(
    merchantId: string,
    parsedRows: ParsedCsvRow[],
  ): Promise<StagedRow[]> {
    const normalized = parsedRows.map((source) => ({
      source,
      result: normalizeImportRecord(source.rawData, this.supportedCurrencies),
    }));
    const duplicateSkus = this.duplicates(
      normalized.map((row) => row.result.data.merchantSku),
    );
    const duplicateBarcodes = this.duplicates(
      normalized.map((row) => row.result.data.barcode),
    );
    const skus = normalized
      .map((row) => row.result.data.merchantSku)
      .filter((value): value is string => Boolean(value));
    const barcodes = normalized
      .map((row) => row.result.data.barcode)
      .filter((value): value is string => Boolean(value));
    const [offersBySku, productsByBarcode] = await Promise.all([
      this.prisma.merchantProduct.findMany({
        where: { merchantId, merchantSku: { in: skus } },
        select: {
          id: true,
          merchantSku: true,
          productId: true,
          price: true,
          currency: true,
          availability: true,
          stockQuantity: true,
          updatedAt: true,
          product: {
            select: { id: true, name: true, barcode: true, status: true },
          },
        },
      }),
      this.prisma.product.findMany({
        where: { barcode: { in: barcodes } },
        select: { id: true, name: true, barcode: true, status: true },
      }),
    ]);
    const productIds = productsByBarcode.map((product) => product.id);
    const offersByProduct = await this.prisma.merchantProduct.findMany({
      where: { merchantId, productId: { in: productIds } },
      select: {
        id: true,
        merchantSku: true,
        productId: true,
        price: true,
        currency: true,
        availability: true,
        stockQuantity: true,
        updatedAt: true,
        product: {
          select: { id: true, name: true, barcode: true, status: true },
        },
      },
    });
    const skuMap = new Map(
      offersBySku.map((offer) => [offer.merchantSku, offer]),
    );
    const barcodeMap = new Map(
      productsByBarcode.map((product) => [product.barcode, product]),
    );
    const productOfferMap = new Map(
      offersByProduct.map((offer) => [offer.productId, offer]),
    );

    return normalized.map(({ source, result }) => {
      const errors = [...result.errors];
      const warnings = [...(source.warnings ?? []), ...result.warnings];
      if (
        result.data.merchantSku &&
        duplicateSkus.has(result.data.merchantSku)
      ) {
        errors.push(
          `Duplicate merchant SKU ${result.data.merchantSku} in this file.`,
        );
      }
      if (result.data.barcode && duplicateBarcodes.has(result.data.barcode)) {
        errors.push(`Duplicate barcode ${result.data.barcode} in this file.`);
      }

      const skuOffer = result.data.merchantSku
        ? skuMap.get(result.data.merchantSku)
        : undefined;
      const barcodeProduct = result.data.barcode
        ? barcodeMap.get(result.data.barcode)
        : undefined;
      const matched = this.resolveMatch(
        result.data,
        skuOffer,
        barcodeProduct,
        productOfferMap,
        errors,
      );
      this.addComparisonWarnings(result.data, matched.offer, warnings);
      if (matched.product?.status === ProductStatus.INACTIVE)
        errors.push('The matched catalog product is inactive.');
      if (!matched.product && !result.data.brand)
        errors.push('Product name and brand are required for new products.');
      if (!matched.product && !validNewProductBarcode(result.data.barcode))
        errors.push(NEW_PRODUCT_BARCODE_ERROR);
      const action =
        errors.length === 0 && !matched.product
          ? IMPORT_ACTIONS.NEW_PRODUCT
          : this.actionFor(result.data, matched.offer, errors);

      return {
        source,
        normalized: result.data,
        stored: {
          ...result.data,
          action,
          currentPrice: matched.offer?.price.toString() ?? null,
          currentCurrency: matched.offer?.currency ?? null,
          currentUpdatedAt: matched.offer?.updatedAt.toISOString() ?? null,
        },
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
        matchedProductId: matched.product?.id ?? null,
        merchantProductId: matched.offer?.id ?? null,
        matchMethod: matched.method,
      };
    });
  }

  private resolveMatch(
    data: NormalizedImportRow,
    skuOffer: ExistingOffer | undefined,
    barcodeProduct: MatchedProduct | undefined,
    productOfferMap: ReadonlyMap<string, ExistingOffer>,
    errors: string[],
  ): {
    product?: MatchedProduct;
    offer?: ExistingOffer;
    method: MatchMethod;
  } {
    if (skuOffer) {
      if (
        (barcodeProduct && barcodeProduct.id !== skuOffer.productId) ||
        (data.barcode &&
          data.barcode !== normalizeIdentifier(skuOffer.product.barcode))
      ) {
        errors.push('Merchant SKU and barcode point to different products.');
      }
      return {
        product: skuOffer.product,
        offer: skuOffer,
        method: MatchMethod.MERCHANT_SKU,
      };
    }
    if (barcodeProduct) {
      const offer = productOfferMap.get(barcodeProduct.id);
      if (offer && data.merchantSku !== offer.merchantSku) {
        errors.push(
          'This product already has a different merchant SKU. Use its existing SKU or edit the listing before importing.',
        );
      }
      return {
        product: barcodeProduct,
        offer,
        method: MatchMethod.BARCODE,
      };
    }

    return { method: MatchMethod.NONE };
  }

  private async validateNewProducts(rows: StagedRow[]): Promise<void> {
    const drafts = rows.filter(
      (row) => row.stored.action === IMPORT_ACTIONS.NEW_PRODUCT,
    );
    if (!drafts.length) return;
    const [products, brands, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          OR: drafts.map(({ normalized: data }) => ({
            name: { equals: data.productName ?? '', mode: 'insensitive' },
            brand: catalogBrandWhere(data.brand ?? ''),
            model: data.model
              ? { equals: data.model, mode: 'insensitive' }
              : null,
          })),
        },
        select: {
          name: true,
          model: true,
          brand: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.brand.findMany({
        where: {
          OR: drafts.map(({ normalized: data }) =>
            catalogBrandWhere(data.brand ?? ''),
          ),
        },
        select: { id: true, name: true, slug: true, active: true },
      }),
      this.prisma.category.findMany({
        where: {
          OR: [
            { slug: 'uncategorized' },
            ...drafts.flatMap(({ normalized: data }) =>
              data.category
                ? [
                    {
                      name: {
                        equals: data.category,
                        mode: 'insensitive' as const,
                      },
                    },
                  ]
                : [],
            ),
          ],
        },
        select: { name: true, slug: true, active: true },
      }),
    ]);
    const draftKey = (data: NormalizedImportRow): string =>
      productDraftKey(
        data,
        brands.find((brand) => catalogBrandMatches(brand, data.brand ?? ''))
          ?.id,
      );
    const duplicates = this.duplicates(
      drafts.map((row) => draftKey(row.normalized)),
    );
    for (const row of drafts) {
      const data = row.normalized;
      if (duplicates.has(draftKey(data)))
        row.errors.push(
          'Multiple new rows have the same name, brand, and model. Clarify the variants before importing.',
        );
      if (
        products.some(
          (product) =>
            catalogText(product.name) === catalogText(data.productName ?? '') &&
            catalogText(product.model ?? '') ===
              catalogText(data.model ?? '') &&
            catalogBrandMatches(product.brand, data.brand ?? ''),
        )
      ) {
        row.errors.push(
          'A product with this name, brand, and model already exists. Use its barcode or select it from Add product; names are not automatic matches.',
        );
      }
      const matchingBrands = brands.filter((brand) =>
        catalogBrandMatches(brand, data.brand ?? ''),
      );
      if (
        matchingBrands.length > 1 ||
        matchingBrands.some((brand) => !brand.active)
      )
        row.errors.push(CATALOG_BRAND_ERROR);
      const matchingCategories = categories.filter((category) =>
        data.category
          ? catalogText(category.name) === catalogText(data.category)
          : category.slug === 'uncategorized',
      );
      if (
        matchingCategories.length > 1 ||
        matchingCategories.some((category) => !category.active) ||
        (data.category && !matchingCategories.length)
      ) {
        row.errors.push(
          'The category is missing, inactive, or ambiguous. Upload again with an active category or leave it blank.',
        );
      } else if (!data.category)
        row.warnings.push(
          'No category supplied. This new product will use Uncategorized.',
        );
      if (!data.barcode)
        row.warnings.push(
          'No barcode supplied. Verify this is a distinct new product before creating it.',
        );
      if (row.errors.length) row.stored.action = IMPORT_ACTIONS.BLOCKED;
    }
  }

  private addComparisonWarnings(
    data: NormalizedImportRow,
    offer: ExistingOffer | undefined,
    warnings: string[],
  ): void {
    if (!offer || !data.price || !data.currency) return;
    if (offer.currency !== data.currency) {
      warnings.push(
        `Currency changes from ${offer.currency} to ${data.currency}.`,
      );
      return;
    }

    const proposed = new Prisma.Decimal(data.price);
    const percentage = proposed
      .minus(offer.price)
      .abs()
      .dividedBy(offer.price)
      .times(100);
    if (percentage.greaterThanOrEqualTo(this.suspiciousChangePercent)) {
      warnings.push(
        `Price changes by ${percentage.toDecimalPlaces(1).toString()}%; verify before committing.`,
      );
    }
  }

  private actionFor(
    data: NormalizedImportRow,
    offer: ExistingOffer | undefined,
    errors: string[],
  ): ImportAction {
    if (errors.length > 0 || !data.price || !data.currency) {
      return IMPORT_ACTIONS.BLOCKED;
    }
    if (!offer) return IMPORT_ACTIONS.NEW_OFFER;
    if (!offer.price.equals(data.price) || offer.currency !== data.currency) {
      return IMPORT_ACTIONS.PRICE_CHANGE;
    }
    if (
      offer.stockQuantity !== data.stock ||
      offer.availability !== data.availability
    ) {
      return IMPORT_ACTIONS.INVENTORY_CHANGE;
    }
    return IMPORT_ACTIONS.UNCHANGED;
  }

  private markDuplicateProducts(rows: StagedRow[]): void {
    const duplicates = this.duplicates(rows.map((row) => row.matchedProductId));
    for (const row of rows) {
      if (row.matchedProductId && duplicates.has(row.matchedProductId)) {
        row.errors.push('Multiple rows in this file match the same product.');
        row.errors = [...new Set(row.errors)];
        row.stored.action = IMPORT_ACTIONS.BLOCKED;
      }
    }
  }

  private duplicates(values: Array<string | null>): Set<string> {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([value]) => value),
    );
  }

  private rowStatus(row: StagedRow): ImportRowStatus {
    if (row.errors.length > 0) return ImportRowStatus.INVALID;
    return row.warnings.length > 0
      ? ImportRowStatus.WARNING
      : ImportRowStatus.VALID;
  }

  private summarize(rows: StagedRow[]): ImportSummary {
    const summary = emptyImportSummary();
    summary.totalRows = rows.length;
    for (const row of rows) {
      const status = this.rowStatus(row);
      if (status === ImportRowStatus.INVALID) summary.invalid += 1;
      if (status === ImportRowStatus.WARNING) summary.warnings += 1;
      if (row.stored.action === IMPORT_ACTIONS.NEW_OFFER)
        summary.newOffers += 1;
      if (row.stored.action === IMPORT_ACTIONS.NEW_PRODUCT)
        summary.newProducts += 1;
      if (row.stored.action === IMPORT_ACTIONS.PRICE_CHANGE)
        summary.priceChanges += 1;
      if (row.stored.action === IMPORT_ACTIONS.INVENTORY_CHANGE) {
        summary.inventoryChanges += 1;
      }
      if (row.stored.action === IMPORT_ACTIONS.UNCHANGED)
        summary.unchanged += 1;
      if (
        status !== ImportRowStatus.INVALID &&
        row.stored.action !== IMPORT_ACTIONS.UNCHANGED
      ) {
        summary.committable += 1;
      }
    }
    return summary;
  }
}
