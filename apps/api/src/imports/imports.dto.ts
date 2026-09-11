import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  ImportRowStatus,
  ImportSource,
  ImportStatus,
  MatchMethod,
  OfferAvailability,
} from '../generated/prisma/client';

export class UploadCsvDto {
  @IsUUID()
  declare merchantId: string;
}

export class ImportTemplateQueryDto {
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx' = 'xlsx';

  @IsOptional()
  @IsUUID()
  merchantId?: string;
}

export class CommitImportDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true)
  @IsBoolean()
  confirmWarnings = false;
}

export class AdminImportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsEnum(ImportStatus)
  status?: ImportStatus;
}

export class ImportSummaryDto {
  declare totalRows: number;
  declare newOffers: number;
  declare priceChanges: number;
  declare inventoryChanges: number;
  declare unchanged: number;
  declare invalid: number;
  declare warnings: number;
  declare committable: number;
}

export class ImportRowPreviewDto {
  declare id: string;
  declare sourceRowNumber: number;
  declare status: ImportRowStatus;
  declare matchMethod: MatchMethod;
  declare merchantSku: string | null;
  declare productName: string | null;
  declare barcode: string | null;
  declare matchedProduct: { id: string; name: string } | null;
  declare currentPrice: { amount: string; currency: string } | null;
  declare proposedPrice: { amount: string; currency: string } | null;
  declare proposedStock: number | null;
  declare proposedAvailability: OfferAvailability | null;
  declare action: string;
  declare errors: string[];
  declare warnings: string[];
}

export class AdminImportItemDto {
  declare id: string;
  declare sourceType: ImportSource;
  declare status: ImportStatus;
  declare originalFilename: string | null;
  declare merchant: { id: string; slug: string; name: string };
  declare summary: ImportSummaryDto;
  declare createdAt: string;
  declare previewedAt: string | null;
  declare committedAt: string | null;
}

export class AdminImportDetailDto extends AdminImportItemDto {
  declare rows: ImportRowPreviewDto[];
}

export class AdminImportListResponseDto extends PaginationMetaDto {
  declare items: AdminImportItemDto[];
}
