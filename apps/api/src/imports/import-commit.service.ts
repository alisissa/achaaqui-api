import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { lockMerchantOffers } from '../common/offer-lock';
import {
  ImportRowStatus,
  ImportStatus,
  OfferAvailability,
  PriceChangeSource,
  Prisma,
  ProductStatus,
} from '../generated/prisma/client';
import { CommitImportDto } from './imports.dto';
import { createImportProducts } from './import-catalog';
import type { NormalizedImportRow } from './import-normalization';
import {
  lockMerchantAccess,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import {
  importSummaryFromJson,
  importPreviewToken,
  IMPORT_ROW_VERSION_SELECT,
  IMPORT_ACTIONS,
  type ImportAction,
  storedNormalizedRow,
} from './import-types';

interface CommitRow {
  id: string;
  merchantProductId: string | null;
  productId: string;
  merchantSku: string;
  price: Prisma.Decimal;
  currency: string;
  stock: number | null;
  availability: OfferAvailability;
  action: ImportAction;
  stagedPrice: Prisma.Decimal | null;
  stagedCurrency: string | null;
  stagedUpdatedAt: string | null;
  newProduct: NormalizedImportRow | null;
}

interface CurrentOffer {
  id: string;
  productId: string;
  merchantSku: string;
  price: Prisma.Decimal;
  currency: string;
  updatedAt: Date;
}

@Injectable()
export class ImportCommitService {
  constructor(private readonly prisma: PrismaService) {}

  async commit(
    id: string,
    input: CommitImportDto,
    actorId = 'local-admin',
    merchantActor?: MerchantActor,
  ): Promise<void> {
    const stagedImport = await this.prisma.import.findUnique({
      where: {
        id,
        ...(merchantActor
          ? {
              merchantId: merchantActor.merchantId,
              sourceType: 'PHOTO' as const,
            }
          : {}),
      },
      select: {
        id: true,
        merchantId: true,
        sourceType: true,
        status: true,
        summary: true,
        rows: {
          select: {
            ...IMPORT_ROW_VERSION_SELECT,
            id: true,
            updatedAt: true,
            status: true,
            normalizedData: true,
            matchedProductId: true,
            merchantProductId: true,
            proposedPrice: true,
            proposedCurrency: true,
            proposedStock: true,
            proposedAvailability: true,
          },
        },
      },
    });
    if (!stagedImport) {
      if (merchantActor) throw new NotFoundException('Import not found.');
      throw new ConflictException('Import not found.');
    }
    if (stagedImport.status === ImportStatus.COMMITTED) return;
    if (stagedImport.status !== ImportStatus.READY) {
      throw new ConflictException(
        'Only an import ready for preview can commit.',
      );
    }

    const previewToken = importPreviewToken(id, stagedImport.rows);
    if (
      (merchantActor || input.expectedPreviewToken) &&
      input.expectedPreviewToken !== previewToken
    ) {
      throw new ConflictException(
        'This preview changed. Reload and review it before confirming again.',
      );
    }
    const rows = stagedImport.rows
      .filter(
        (row) =>
          row.status === ImportRowStatus.VALID ||
          row.status === ImportRowStatus.WARNING,
      )
      .map((row) => {
        const normalized = storedNormalizedRow(row.normalizedData);
        return { row, normalized };
      });
    if (
      rows.some(
        ({ normalized }) => normalized.action === IMPORT_ACTIONS.NEW_PRODUCT,
      ) &&
      (input.confirmNewProducts !== true ||
        input.expectedPreviewToken !== previewToken)
    ) {
      throw new ConflictException(
        'Review and explicitly confirm the new catalog products before committing.',
      );
    }
    // Even an unchanged offer can contain an uncertain numeric SKU. Refreshing
    // freshness is a live write and must not bypass warning acknowledgement.
    const warningRows = rows.filter(
      ({ row }) => row.status === ImportRowStatus.WARNING,
    );
    if (warningRows.length > 0 && !input.confirmWarnings) {
      throw new ConflictException(
        'This import has warnings. Confirm warnings before committing.',
      );
    }
    if (rows.length === 0) {
      throw new ConflictException('This import has no valid rows to commit.');
    }

    const commitRows = rows.map(({ row, normalized }) => {
      if (
        (!row.matchedProductId &&
          normalized.action !== IMPORT_ACTIONS.NEW_PRODUCT) ||
        normalized.action === IMPORT_ACTIONS.BLOCKED ||
        !normalized.merchantSku ||
        !row.proposedPrice ||
        !row.proposedCurrency ||
        !row.proposedAvailability
      ) {
        throw new ConflictException(
          `Import row ${row.id} is missing normalized commit data.`,
        );
      }
      return {
        id: row.id,
        merchantProductId: row.merchantProductId,
        productId: row.matchedProductId ?? randomUUID(),
        newProduct:
          normalized.action === IMPORT_ACTIONS.NEW_PRODUCT ? normalized : null,
        merchantSku: normalized.merchantSku,
        price: row.proposedPrice,
        currency: row.proposedCurrency,
        stock: row.proposedStock,
        availability: row.proposedAvailability,
        action: normalized.action,
        stagedPrice: normalized.currentPrice
          ? new Prisma.Decimal(normalized.currentPrice)
          : null,
        stagedCurrency: normalized.currentCurrency,
        stagedUpdatedAt: normalized.currentUpdatedAt,
      } satisfies CommitRow;
    });
    const changedRows = commitRows.filter(
      (row) => row.action !== IMPORT_ACTIONS.UNCHANGED,
    );
    const unchangedIds = rows
      .filter(
        ({ normalized }) => normalized.action === IMPORT_ACTIONS.UNCHANGED,
      )
      .map(({ row }) => row.id);

    await this.prisma
      .$transaction(
        async (transaction) => {
          if (merchantActor)
            await lockMerchantAccess(transaction, merchantActor);
          const claimed = await transaction.import.updateMany({
            where: {
              id,
              merchantId: stagedImport.merchantId,
              status: ImportStatus.READY,
            },
            data: { status: ImportStatus.VALIDATING },
          });
          if (claimed.count !== 1) {
            throw new ConflictException('Import is already being committed.');
          }
          const currentRows = await transaction.importRow.findMany({
            where: { importId: id },
            select: IMPORT_ROW_VERSION_SELECT,
          });
          if (importPreviewToken(id, currentRows) !== previewToken)
            throw new ConflictException(
              'This preview changed. Reload and review it before confirming again.',
            );
          const merchant = await transaction.merchant.findUnique({
            where: { id: stagedImport.merchantId },
            select: { active: true },
          });
          if (!merchant?.active) {
            throw new ConflictException(
              'The merchant is no longer active. Create a new preview before committing.',
            );
          }
          await createImportProducts(
            transaction,
            commitRows.flatMap((row) =>
              row.newProduct
                ? [{ id: row.productId, data: row.newProduct }]
                : [],
            ),
          );
          await lockMerchantOffers(
            transaction,
            stagedImport.merchantId,
            commitRows.map((row) => row.productId),
          );
          const products = await transaction.product.findMany({
            where: {
              id: { in: commitRows.map((row) => row.productId) },
              status: ProductStatus.ACTIVE,
            },
            select: { id: true },
          });
          if (
            products.length !==
            new Set(commitRows.map((row) => row.productId)).size
          ) {
            throw new ConflictException(
              'One or more products changed after preview. Create a new preview before committing.',
            );
          }
          const currentOffers = await transaction.merchantProduct.findMany({
            where: {
              merchantId: stagedImport.merchantId,
              productId: { in: commitRows.map((row) => row.productId) },
            },
            select: {
              id: true,
              productId: true,
              merchantSku: true,
              price: true,
              currency: true,
              updatedAt: true,
            },
          });
          const currentOffersByProduct = new Map(
            currentOffers.map((offer) => [offer.productId, offer]),
          );
          this.assertPreviewIsCurrent(commitRows, currentOffersByProduct);

          const committedAt = new Date(
            Math.max(
              Date.now(),
              ...currentOffers.map((offer) => offer.updatedAt.getTime() + 1),
            ),
          );
          if (commitRows.length > 0) {
            await this.upsertOffers(
              transaction,
              stagedImport.merchantId,
              commitRows,
              committedAt,
            );
          }
          const offers = await transaction.merchantProduct.findMany({
            where: {
              merchantId: stagedImport.merchantId,
              productId: { in: commitRows.map((row) => row.productId) },
            },
            select: { id: true, productId: true },
          });
          const offerIds = new Map(
            offers.map((offer) => [offer.productId, offer.id]),
          );
          const history = changedRows
            .filter(
              (row) =>
                row.action === IMPORT_ACTIONS.NEW_OFFER ||
                row.action === IMPORT_ACTIONS.NEW_PRODUCT ||
                row.action === IMPORT_ACTIONS.PRICE_CHANGE,
            )
            .map((row) => {
              const merchantProductId = offerIds.get(row.productId);
              if (!merchantProductId) {
                throw new ConflictException(
                  'Committed offer could not be resolved.',
                );
              }
              const previousOffer = currentOffersByProduct.get(row.productId);
              return {
                merchantProductId,
                oldPrice: previousOffer?.price ?? null,
                oldCurrency: previousOffer?.currency ?? null,
                newPrice: row.price,
                currency: row.currency,
                source:
                  stagedImport.sourceType === 'PHOTO'
                    ? PriceChangeSource.PHOTO
                    : stagedImport.sourceType === 'XLSX'
                      ? PriceChangeSource.XLSX
                      : PriceChangeSource.CSV,
                importId: id,
                importRowId: row.id,
                actorId,
                changedAt: committedAt,
              };
            });
          if (history.length > 0) {
            await transaction.priceHistory.createMany({ data: history });
          }
          if (changedRows.length > 0) {
            await this.markCommittedRows(transaction, changedRows, offerIds);
          }
          if (unchangedIds.length > 0) {
            await transaction.importRow.updateMany({
              where: { id: { in: unchangedIds } },
              data: {
                status: ImportRowStatus.SKIPPED,
                commitResult: { action: IMPORT_ACTIONS.UNCHANGED },
              },
            });
          }

          const summary = importSummaryFromJson(stagedImport.summary);
          await transaction.import.update({
            where: { id },
            data: {
              status: ImportStatus.COMMITTED,
              committedAt,
              summary: {
                ...summary,
                committedRows: changedRows.length,
                verifiedRows: unchangedIds.length,
              },
            },
            select: { id: true },
          });
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'A product, brand, or SKU now conflicts with this preview. Upload again and review the catalog.',
          );
        }
        throw error;
      });
  }

  private async upsertOffers(
    transaction: Prisma.TransactionClient,
    merchantId: string,
    rows: CommitRow[],
    now: Date,
  ): Promise<void> {
    const values = rows.map(
      (row) => Prisma.sql`(
        ${randomUUID()}::uuid,
        ${merchantId}::uuid,
        ${row.productId}::uuid,
        ${row.merchantSku},
        ${row.price}::numeric,
        ${row.currency},
        ${row.availability}::"OfferAvailability",
        ${row.stock},
        ${now},
        TRUE,
        ${now},
        ${now}
      )`,
    );

    await transaction
      .$executeRaw(
        Prisma.sql`
      INSERT INTO "MerchantProduct" (
        "id", "merchantId", "productId", "merchantSku", "price", "currency",
        "availability", "stockQuantity", "sourceUpdatedAt", "active",
        "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("merchantId", "productId") DO UPDATE SET
        "price" = EXCLUDED."price",
        "currency" = EXCLUDED."currency",
        "availability" = EXCLUDED."availability",
        "stockQuantity" = EXCLUDED."stockQuantity",
        "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
      )
      .catch((error: unknown) => {
        // Prisma's raw SQL path wraps PostgreSQL uniqueness errors in P2010,
        // including adapter-pg's nested cause. Do not expose SQL/constraint details.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2010'
        ) {
          const adapterError: unknown = error.meta?.driverAdapterError;
          const cause: unknown =
            adapterError instanceof Error ? adapterError.cause : undefined;
          const code: unknown =
            error.meta?.code ??
            (cause && typeof cause === 'object' && 'originalCode' in cause
              ? cause.originalCode
              : undefined);
          if (code === '23505') {
            throw new ConflictException(
              'An offer SKU is already in use. Upload the file again and review the current listings before committing.',
            );
          }
        }
        throw error;
      });
  }

  private assertPreviewIsCurrent(
    rows: readonly CommitRow[],
    currentOffers: ReadonlyMap<string, CurrentOffer>,
  ): void {
    for (const row of rows) {
      const current = currentOffers.get(row.productId);
      const stagedExistingOffer = row.merchantProductId !== null;
      const sameOffer = current?.id === row.merchantProductId;
      const sameSku = current?.merchantSku === row.merchantSku;
      const samePrice = Boolean(
        current && row.stagedPrice && current.price.equals(row.stagedPrice),
      );
      const sameCurrency = current?.currency === row.stagedCurrency;
      const sameVersion =
        current?.updatedAt.toISOString() === row.stagedUpdatedAt;

      if (
        (stagedExistingOffer &&
          (!sameOffer ||
            !sameSku ||
            !samePrice ||
            !sameCurrency ||
            !sameVersion)) ||
        (!stagedExistingOffer && current)
      ) {
        throw new ConflictException(
          'An offer changed after this preview. Upload the file again and review the latest prices before committing.',
        );
      }
    }
  }

  private async markCommittedRows(
    transaction: Prisma.TransactionClient,
    rows: CommitRow[],
    offerIds: ReadonlyMap<string, string>,
  ): Promise<void> {
    const values = rows.map((row) => {
      const offerId = offerIds.get(row.productId);
      if (!offerId) {
        throw new ConflictException('Committed offer could not be resolved.');
      }
      return Prisma.sql`(${row.id}::uuid, ${offerId}::uuid, ${row.productId}::uuid, ${row.action})`;
    });

    await transaction.$executeRaw(Prisma.sql`
      UPDATE "ImportRow" AS target
      SET
        "merchantProductId" = source."merchantProductId",
        "matchedProductId" = source."productId",
        "status" = 'COMMITTED'::"ImportRowStatus",
        "commitResult" = jsonb_build_object(
          'action', source."action",
          'productId', source."productId",
          'merchantProductId', source."merchantProductId"
        ),
        "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(values)})
        AS source("id", "merchantProductId", "productId", "action")
      WHERE target."id" = source."id"
    `);
  }
}
