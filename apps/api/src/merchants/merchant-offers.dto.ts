import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { OfferAvailability } from '../generated/prisma/client';

export class MerchantIdParamDto {
  @IsUUID()
  declare merchantId: string;
}

export class MerchantOfferParamDto extends MerchantIdParamDto {
  @IsUUID()
  declare offerId: string;
}

export class OfferQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

export class NewCatalogProductDto {
  @IsString()
  @Length(2, 240)
  declare name: string;

  @IsString()
  @Length(2, 120)
  declare brand: string;

  @IsUUID()
  declare categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string;
}

export class OfferValuesDto {
  @IsString()
  @Length(1, 120)
  declare merchantSku: string;

  @IsString()
  @MaxLength(32)
  declare price: string;

  @IsString()
  @Length(3, 3)
  declare currency: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  stock?: string;

  @IsEnum(OfferAvailability)
  declare availability: OfferAvailability;

  @Equals(true, { message: 'Confirm the offer change before saving.' })
  declare confirmed: boolean;

  @IsOptional()
  @IsBoolean()
  confirmWarnings = false;
}

export class CreateMerchantOfferDto extends OfferValuesDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewCatalogProductDto)
  newProduct?: NewCatalogProductDto;
}

export class UpdateMerchantOfferDto extends OfferValuesDto {
  @IsISO8601({ strict: true })
  declare expectedUpdatedAt: string;

  @IsBoolean()
  declare active: boolean;
}

export class RemoveMerchantOfferDto {
  @IsISO8601({ strict: true })
  declare expectedUpdatedAt: string;

  @Equals(true, { message: 'Confirm removal of this merchant offer.' })
  declare confirmed: boolean;
}

export class AdminOfferDto {
  declare id: string;
  declare merchantSku: string;
  declare price: { amount: string; currency: string };
  declare availability: OfferAvailability;
  declare stockQuantity: number | null;
  declare active: boolean;
  declare updatedAt: string;
  declare sourceUpdatedAt: string;
  declare product: {
    id: string;
    name: string;
    slug: string;
    barcode: string | null;
  };
}

export class AdminOfferListDto extends PaginationMetaDto {
  declare items: AdminOfferDto[];
}

export class CatalogProductChoiceDto {
  declare id: string;
  declare name: string;
  declare barcode: string | null;
  declare brand: { name: string };
}

export class CatalogProductChoiceListDto extends PaginationMetaDto {
  declare items: CatalogProductChoiceDto[];
}
