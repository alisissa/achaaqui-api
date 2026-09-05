import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CategoryListResponseDto } from './categories.dto';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: CategoryListResponseDto })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<CategoryListResponseDto> {
    return await this.categoriesService.list(query);
  }
}
