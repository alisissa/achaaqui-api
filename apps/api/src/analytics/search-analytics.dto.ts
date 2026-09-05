import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ClientPlatform } from '../generated/prisma/client';

export class AdminSearchQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsEnum(ClientPlatform)
  platform?: ClientPlatform;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class SearchHitDto {
  declare merchant: { id: string; slug: string; name: string };
  declare product: { id: string; slug: string; name: string };
}

export class AdminSearchItemDto {
  declare id: string;
  declare query: string;
  declare platform: ClientPlatform;
  declare clientVersion: string | null;
  declare countryCode: string | null;
  declare resultCount: number;
  declare page: number;
  declare pageSize: number;
  declare anonymousVisitor: boolean;
  declare createdAt: string;
  declare hits: SearchHitDto[];
}

export class AdminSearchListResponseDto extends PaginationMetaDto {
  declare items: AdminSearchItemDto[];
}

export class SearchCountDto {
  declare label: string;
  declare count: number;
}

export class MerchantSearchCountDto {
  declare merchant: { id: string; slug: string; name: string };
  declare searchCount: number;
  declare productImpressions: number;
}

export class AdminSearchSummaryDto {
  declare days: number;
  declare totalSearches: number;
  declare uniqueVisitorEstimate: number;
  declare platformCounts: SearchCountDto[];
  declare topQueries: SearchCountDto[];
  declare merchantCounts: MerchantSearchCountDto[];
}
