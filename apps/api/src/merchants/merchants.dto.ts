import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FreshnessDto } from '../common/freshness/freshness.dto';
import type { OfferAvailability } from '../generated/prisma/client';
import { NamedReferenceDto, PriceDto } from '../products/products.dto';
import { RatingSummaryDto } from '../reviews/reviews.dto';

export class MerchantOffersQueryDto extends PaginationQueryDto {
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
}

export class MerchantSummaryDto {
  declare id: string;
  declare slug: string;
  declare name: string;
  declare logoUrl: string | null;
  declare city: string | null;
  declare countryCode: string | null;
  declare offerCount: number;
  declare rating: RatingSummaryDto;
}

export class MerchantListResponseDto extends PaginationMetaDto {
  declare items: MerchantSummaryDto[];
}

export class MerchantDetailDto extends MerchantSummaryDto {
  declare address: string | null;
  declare phone: string | null;
  declare email: string | null;
  declare websiteUrl: string | null;
}

export class MerchantOfferItemDto {
  declare id: string;
  declare merchantSku: string;
  declare price: PriceDto;
  declare availability: OfferAvailability;
  declare stockQuantity: number | null;
  declare freshness: FreshnessDto;
  declare productRating: RatingSummaryDto;
  declare merchantRating: RatingSummaryDto;
  declare combinedRating: number | null;
  declare product: {
    id: string;
    slug: string;
    name: string;
    model: string | null;
    primaryImage: string | null;
    brand: NamedReferenceDto;
    category: NamedReferenceDto;
  };
}

export class MerchantOfferListResponseDto extends PaginationMetaDto {
  declare items: MerchantOfferItemDto[];
}

export class AdminMerchantQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class CreateMerchantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  declare name: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(240)
  email?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;
}

export class AdminMerchantItemDto extends MerchantDetailDto {
  declare active: boolean;
  declare createdAt: string;
}

export class AdminMerchantListResponseDto extends PaginationMetaDto {
  declare items: AdminMerchantItemDto[];
}
