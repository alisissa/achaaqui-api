import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

export enum AdminProductSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME = 'name',
}

export class AdminProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsEnum(AdminProductSort)
  sort: AdminProductSort = AdminProductSort.NEWEST;
}

export interface AdminProductItem {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  barcode: string | null;
  model: string | null;
  brand: string;
  category: { id: string; name: string };
  imageUrl: string | null;
  // Lowest active offer price (of the filtered merchant, when one is chosen).
  lowestPrice: { amount: string; currency: string } | null;
  offerCount: number;
  merchants: { id: string; name: string }[];
  createdAt: string;
}

export interface AdminProductList {
  items: AdminProductItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
