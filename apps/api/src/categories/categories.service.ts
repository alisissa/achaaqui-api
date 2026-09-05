import { Injectable } from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { ProductStatus } from '../generated/prisma/client';
import { CategoryListResponseDto, CategorySummaryDto } from './categories.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQueryDto): Promise<CategoryListResponseDto> {
    const skip = (query.page - 1) * query.pageSize;
    const where = { active: true };
    const [total, categories] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          _count: {
            select: {
              products: { where: { status: ProductStatus.ACTIVE } },
            },
          },
        },
      }),
    ]);
    const items: CategorySummaryDto[] = categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      productCount: category._count.products,
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }
}
