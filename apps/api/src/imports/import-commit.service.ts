import { ConflictException, Injectable } from '@nestjs/common';
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
import {
  importSummaryFromJson,
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
}

interface CurrentOffer {
  id: string;
  productId: string;
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
  ): Promise<void> {
    const stagedImport = await this.prisma.import.findUnique({
      where: { id },
      select: {
        id: true,
        merchantId: true,
        sourceType: true,
        status: true,
        summary: true,
        rows: {
          where: {
            status: { in: [ImportRowStatus.VALID, ImportRowStatus.WARNING] },
          },
          select: {
            id: true,
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
    if (!stagedImport) throw new ConflictException('Import not found.');
    if (stagedImport.status === ImportStatus.COMMITTED) return;
    if (stagedImport.status !== ImportStatus.READY) {
      throw new ConflictException(
        'Only an import ready for preview can commit.',
      );
    }

    const rows = stagedImport.rows.map((row) => {
      const normalized = storedNormalizedRow(row.normalizedData);
      return { row, normalized };
    });
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
        !row.matchedProductId ||
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
        productId: row.matchedProductId,
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

    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.import.updateMany({
        where: { id, status: ImportStatus.READY },
        data: { status: ImportStatus.VALIDATING },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Import is already being committed.');
      }

      await lockMerchantOffers(
        transaction,
        stagedImport.merchantId,
        commitRows.map((row) => row.productId),
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
      const products = await transaction.product.findMany({
        where: {
          id: { in: commitRows.map((row) => row.productId) },
          status: ProductStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (
        products.length !== new Set(commitRows.map((row) => row.productId)).size
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
              stagedImport.sourceType === 'XLSX'
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

    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "MerchantProduct" (
        "id", "merchantId", "productId", "merchantSku", "price", "currency",
        "availability", "stockQuantity", "sourceUpdatedAt", "active",
        "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("merchantId", "productId") DO UPDATE SET
        "merchantSku" = EXCLUDED."merchantSku",
        "price" = EXCLUDED."price",
        "currency" = EXCLUDED."currency",
        "availability" = EXCLUDED."availability",
        "stockQuantity" = EXCLUDED."stockQuantity",
        "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }

  private assertPreviewIsCurrent(
    rows: readonly CommitRow[],
    currentOffers: ReadonlyMap<string, CurrentOffer>,
  ): void {
    for (const row of rows) {
      const current = currentOffers.get(row.productId);
      const stagedExistingOffer = row.merchantProductId !== null;
      const sameOffer = current?.id === row.merchantProductId;
      const samePrice = Boolean(
        current && row.stagedPrice && current.price.equals(row.stagedPrice),
      );
      const sameCurrency = current?.currency === row.stagedCurrency;
      const sameVersion =
        current?.updatedAt.toISOString() === row.stagedUpdatedAt;

      if (
        (stagedExistingOffer &&
          (!sameOffer || !samePrice || !sameCurrency || !sameVersion)) ||
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
      return Prisma.sql`(${row.id}::uuid, ${offerId}::uuid, ${row.action})`;
    });

    await transaction.$executeRaw(Prisma.sql`
      UPDATE "ImportRow" AS target
      SET
        "merchantProductId" = source."merchantProductId",
        "status" = 'COMMITTED'::"ImportRowStatus",
        "commitResult" = jsonb_build_object(
          'action', source."action",
          'merchantProductId', source."merchantProductId"
        ),
        "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(values)})
        AS source("id", "merchantProductId", "action")
      WHERE target."id" = source."id"
    `);
  }
}
