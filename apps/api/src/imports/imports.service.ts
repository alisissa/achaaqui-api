import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { ImportStatus, Prisma } from '../generated/prisma/client';
import {
  AdminImportDetailDto,
  AdminImportItemDto,
  AdminImportListResponseDto,
  AdminImportQueryDto,
  ImportRowPreviewDto,
} from './imports.dto';
import {
  importSummaryFromJson,
  storedNormalizedRow,
  stringArray,
} from './import-types';

const IMPORT_ITEM_SELECT = {
  id: true,
  sourceType: true,
  status: true,
  originalFilename: true,
  summary: true,
  createdAt: true,
  previewedAt: true,
  committedAt: true,
  merchant: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.ImportSelect;

const IMPORT_DETAIL_SELECT = {
  ...IMPORT_ITEM_SELECT,
  rows: {
    orderBy: { sourceRowNumber: 'asc' },
    select: {
      id: true,
      sourceRowNumber: true,
      normalizedData: true,
      status: true,
      matchMethod: true,
      proposedPrice: true,
      proposedCurrency: true,
      proposedStock: true,
      proposedAvailability: true,
      validationErrors: true,
      warnings: true,
      matchedProduct: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ImportSelect;

type ImportItemRecord = Prisma.ImportGetPayload<{
  select: typeof IMPORT_ITEM_SELECT;
}>;
type ImportDetailRecord = Prisma.ImportGetPayload<{
  select: typeof IMPORT_DETAIL_SELECT;
}>;

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminImportQueryDto): Promise<AdminImportListResponseDto> {
    const where: Prisma.ImportWhereInput = {
      ...(query.merchantId ? { merchantId: query.merchantId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, imports] = await Promise.all([
      this.prisma.import.count({ where }),
      this.prisma.import.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: IMPORT_ITEM_SELECT,
      }),
    ]);

    return {
      items: imports.map((item) => this.toItem(item)),
      ...paginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(id: string): Promise<AdminImportDetailDto> {
    const item = await this.prisma.import.findUnique({
      where: { id },
      select: IMPORT_DETAIL_SELECT,
    });
    if (!item) throw new NotFoundException('Import not found.');
    return this.toDetail(item);
  }

  async cancel(id: string): Promise<void> {
    const cancelled = await this.prisma.import.updateMany({
      where: {
        id,
        status: { in: [ImportStatus.READY, ImportStatus.UPLOADED] },
      },
      data: { status: ImportStatus.CANCELLED },
    });
    if (cancelled.count === 1) return;

    const item = await this.prisma.import.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!item) throw new NotFoundException('Import not found.');
    if (item.status === ImportStatus.CANCELLED) return;
    throw new ConflictException(
      item.status === ImportStatus.COMMITTED
        ? 'A committed import cannot be cancelled.'
        : 'This import is already being processed and cannot be cancelled.',
    );
  }

  private toItem(item: ImportItemRecord): AdminImportItemDto {
    return {
      id: item.id,
      sourceType: item.sourceType,
      status: item.status,
      originalFilename: item.originalFilename,
      merchant: item.merchant,
      summary: importSummaryFromJson(item.summary),
      createdAt: item.createdAt.toISOString(),
      previewedAt: item.previewedAt?.toISOString() ?? null,
      committedAt: item.committedAt?.toISOString() ?? null,
    };
  }

  private toDetail(item: ImportDetailRecord): AdminImportDetailDto {
    return {
      ...this.toItem(item),
      rows: item.rows.map((row): ImportRowPreviewDto => {
        const normalized = storedNormalizedRow(row.normalizedData);
        return {
          id: row.id,
          sourceRowNumber: row.sourceRowNumber,
          status: row.status,
          matchMethod: row.matchMethod,
          merchantSku: normalized.merchantSku,
          productName: normalized.productName,
          barcode: normalized.barcode,
          matchedProduct: row.matchedProduct,
          currentPrice:
            normalized.currentPrice && normalized.currentCurrency
              ? {
                  amount: normalized.currentPrice,
                  currency: normalized.currentCurrency,
                }
              : null,
          proposedPrice:
            row.proposedPrice && row.proposedCurrency
              ? {
                  amount: row.proposedPrice.toString(),
                  currency: row.proposedCurrency,
                }
              : null,
          proposedStock: row.proposedStock,
          proposedAvailability: row.proposedAvailability,
          action: normalized.action,
          errors: stringArray(row.validationErrors),
          warnings: stringArray(row.warnings),
        };
      }),
    };
  }
}
