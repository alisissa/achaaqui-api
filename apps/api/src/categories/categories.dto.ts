import { PaginationMetaDto } from '../common/dto/pagination-meta.dto';

export class CategorySummaryDto {
  declare id: string;
  declare slug: string;
  declare name: string;
  declare description: string | null;
  declare productCount: number;
}

export class CategoryListResponseDto extends PaginationMetaDto {
  declare items: CategorySummaryDto[];
}
