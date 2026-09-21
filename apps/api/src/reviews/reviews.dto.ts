import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ReviewStatus } from '../generated/prisma/client';

export class RatingSummaryDto {
  declare average: number | null;
  declare count: number;
}

export class AdminReviewQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['true'])
  reported?: string;
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class UpdateReviewStatusDto {
  @IsEnum(ReviewStatus)
  declare status: ReviewStatus;
}

export class AdminReviewItemDto {
  declare reviewerAccess?: { banned: boolean; revision: string | null } | null;
  declare reports?: { id: string; reason: string; createdAt: string }[];
  declare reportCount?: number;
  declare id: string;
  declare productRating: number;
  declare merchantRating: number | null;
  declare combinedRating: number | null;
  declare reviewerDisplayName: string | null;
  declare title: string | null;
  declare comment: string | null;
  declare status: ReviewStatus;
  declare createdAt: string;
  declare moderatedAt: string | null;
  declare merchant: { id: string; slug: string; name: string } | null;
  declare product: { id: string; slug: string; name: string };
}

export class AdminReviewListResponseDto extends PaginationMetaDto {
  declare items: AdminReviewItemDto[];
}

export class ReviewStatusCountDto {
  declare status: ReviewStatus;
  declare count: number;
}

export class AdminReviewSummaryDto {
  declare total: number;
  declare pending: number;
  declare statusCounts: ReviewStatusCountDto[];
  declare publishedProductRating: RatingSummaryDto;
  declare publishedMerchantRating: RatingSummaryDto;
}
