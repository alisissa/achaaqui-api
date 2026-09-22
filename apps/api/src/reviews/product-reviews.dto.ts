import { Transform } from 'class-transformer';
import {
  IsInt,
  Equals,
  IsUUID,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';
import { ReviewStatus } from '../generated/prisma/client';

export class CreateProductReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  declare rating: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class DeleteOwnReviewDto {
  @IsUUID()
  declare reviewId: string;

  @Equals(true)
  declare confirmed: true;
}

export class ProductReviewDto {
  declare id: string;
  declare rating: number;
  declare comment: string | null;
  declare createdAt: string;
}

export class OwnProductReviewDto extends ProductReviewDto {
  declare status: ReviewStatus;
}

export class ProductReviewListDto extends PaginationMetaDto {
  declare items: ProductReviewDto[];
}

export class OwnProductReviewResponseDto {
  declare review: OwnProductReviewDto | null;
}

export class ReviewIdentityDto {
  declare token: string;
}
