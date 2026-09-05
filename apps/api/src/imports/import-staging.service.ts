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
import { UploadCsvDto } from './imports.dto';
import {
  normalizeImportRecord,
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
  product: { id: string; name: string; barcode: string | null };
}

interface MatchedProduct {
  id: string;
  name: string;
  barcode: string | null;
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
  ): Promise<string> {
    this.validateFile(file);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchantId },
      select: { id: true, active: true },
    });
    if (!merchant || !merchant.active) {
      throw new NotFoundException('Active merchant not found.');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const commitKey = `import:${randomUUID()}`;

    const parsedRows = parseCsv(file.buffer);
    if (parsedRows.length === 0) {
      throw new BadRequestException('The CSV contains no data rows.');
    }
    if (parsedRows.length > this.maxRows) {
      throw new BadRequestException(
        `This first import version accepts up to ${this.maxRows} rows per file.`,
      );
    }

    const stagedRows = await this.matchRows(merchant.id, parsedRows);
    this.markDuplicateProducts(stagedRows);
    const summary = this.summarize(stagedRows);
    const created = await this.prisma.import.create({
      data: {
        merchantId: merchant.id,
        sourceType: ImportSource.CSV,
        status: ImportStatus.READY,
        originalFilename: file.originalname,
        sourceReference: `sha256:${fileHash}`,
        mappingSnapshot: {
          version: 1,
          mode: 'canonical-csv',
        },
        summary: { ...summary },
        commitKey,
        actorId: 'admin-api-key',
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
  ): asserts file is UploadedCsvFile {
    if (!file) throw new BadRequestException('A CSV file is required.');
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted for now.');
    }
    if (file.size <= 0 || file.size > this.maxFileBytes) {
      throw new BadRequestException(
        `CSV size must be between 1 byte and ${this.maxFileBytes} bytes.`,
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
          product: { select: { id: true, name: true, barcode: true } },
        },
      }),
      this.prisma.product.findMany({
        where: { barcode: { in: barcodes }, status: ProductStatus.ACTIVE },
        select: { id: true, name: true, barcode: true },
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
        product: { select: { id: true, name: true, barcode: true } },
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
      const warnings = [...result.warnings];
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
      const action = this.actionFor(result.data, matched.offer, errors);

      return {
        source,
        normalized: result.data,
        stored: {
          ...result.data,
          action,
          currentPrice: matched.offer?.price.toString() ?? null,
          currentCurrency: matched.offer?.currency ?? null,
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
      if (barcodeProduct && barcodeProduct.id !== skuOffer.productId) {
        errors.push('Merchant SKU and barcode point to different products.');
      }
      return {
        product: skuOffer.product,
        offer: skuOffer,
        method: MatchMethod.MERCHANT_SKU,
      };
    }
    if (barcodeProduct) {
      return {
        product: barcodeProduct,
        offer: productOfferMap.get(barcodeProduct.id),
        method: MatchMethod.BARCODE,
      };
    }

    errors.push(
      data.barcode
        ? `No active product has barcode ${data.barcode}.`
        : 'Unknown SKU requires an exact barcode match.',
    );
    return { method: MatchMethod.NONE };
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
