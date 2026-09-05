import { Type, Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FreshnessDto } from '../common/freshness/freshness.dto';
import type { OfferAvailability } from '../generated/prisma/client';
import { RatingSummaryDto } from '../reviews/reviews.dto';

export enum ProductSort {
  FEATURED = 'featured',
  RECENT = 'recent',
  POPULAR = 'popular',
}

export class ProductListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  categorySlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  merchantSlug?: string;

  @IsOptional()
  @IsEnum(ProductSort)
  sort: ProductSort = ProductSort.FEATURED;
}

export class PriceHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 90;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  merchantSlug?: string;
}

export class NamedReferenceDto {
  declare id: string;
  declare slug: string;
  declare name: string;
}

export class PriceDto {
  /** Decimal string, never a floating-point value. */
  declare amount: string;
  declare currency: string;
}

export class MerchantReferenceDto extends NamedReferenceDto {
  declare logoUrl: string | null;
  declare city: string | null;
}

export class ProductImageDto {
  declare id: string;
  declare url: string;
  declare altText: string | null;
  declare sortOrder: number;
}

export class ProductSummaryDto {
  declare id: string;
  declare slug: string;
  declare name: string;
  declare model: string | null;
  declare brand: NamedReferenceDto;
  declare category: NamedReferenceDto;
  declare primaryImage: string | null;
  /** Present only when all active offers use one currency. */
  declare bestPrice: PriceDto | null;
  /** Lowest available offer in each displayed currency. */
  declare bestPrices: PriceDto[];
  declare merchantCount: number;
  declare available: boolean;
  declare freshness: FreshnessDto | null;
  declare createdAt: string;
  declare rating: RatingSummaryDto;
}

export class ProductListResponseDto extends PaginationMetaDto {
  declare items: ProductSummaryDto[];
}

export class OfferDto {
  declare id: string;
  declare merchantSku: string;
  declare merchant: MerchantReferenceDto;
  declare price: PriceDto;
  declare availability: OfferAvailability;
  declare stockQuantity: number | null;
  declare freshness: FreshnessDto;
  declare merchantRating: RatingSummaryDto;
  declare combinedRating: number | null;
}

export class ProductDetailDto {
  declare id: string;
  declare slug: string;
  declare name: string;
  declare description: string | null;
  declare model: string | null;
  declare barcode: string | null;
  declare brand: NamedReferenceDto;
  declare category: NamedReferenceDto;
  declare images: ProductImageDto[];
  /** Present only when all active offers use one currency. */
  declare bestPrice: PriceDto | null;
  /** Lowest available offer in each displayed currency. */
  declare bestPrices: PriceDto[];
  declare favoriteKey: string;
  declare freshness: FreshnessDto | null;
  declare rating: RatingSummaryDto;
  declare offers: OfferDto[];
}

export class PriceHistoryItemDto {
  declare id: string;
  declare merchant: MerchantReferenceDto;
  declare oldPrice: PriceDto | null;
  declare newPrice: PriceDto;
  declare source: string;
  declare changedAt: string;
}

export class PriceHistoryResponseDto extends PaginationMetaDto {
  declare items: PriceHistoryItemDto[];
}
