import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SlugParamDto } from '../common/dto/slug-param.dto';
import { SearchAnalyticsService } from '../analytics/search-analytics.service';
import type { Request } from 'express';
import { Req } from '@nestjs/common';
import {
  PriceHistoryQueryDto,
  PriceHistoryResponseDto,
  ProductDetailDto,
  ProductListQueryDto,
  ProductListResponseDto,
} from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ProductListResponseDto })
  async list(
    @Query() query: ProductListQueryDto,
    @Req() request: Request,
  ): Promise<ProductListResponseDto> {
    return await this.productsService.list(
      query,
      this.searchAnalyticsService.contextFromRequest(request),
    );
  }

  @Get(':slug/price-history')
  @ApiOkResponse({ type: PriceHistoryResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async priceHistory(
    @Param() params: SlugParamDto,
    @Query() query: PriceHistoryQueryDto,
  ): Promise<PriceHistoryResponseDto> {
    return await this.productsService.priceHistory(params.slug, query);
  }

  @Get(':slug')
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async detail(@Param() params: SlugParamDto): Promise<ProductDetailDto> {
    return await this.productsService.detail(params.slug);
  }
}
