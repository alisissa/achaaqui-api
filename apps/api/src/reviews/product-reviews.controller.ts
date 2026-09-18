import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SlugParamDto } from '../common/dto/slug-param.dto';
import {
  CreateProductReviewDto,
  OwnProductReviewDto,
  OwnProductReviewResponseDto,
  ProductReviewListDto,
  ReviewIdentityDto,
} from './product-reviews.dto';
import { ProductReviewsService } from './product-reviews.service';

@ApiTags('product reviews')
@Controller('reviews')
export class ReviewIdentityController {
  constructor(private readonly reviews: ProductReviewsService) {}

  @Post('identity')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: ReviewIdentityDto })
  identity(): ReviewIdentityDto {
    return this.reviews.createIdentity();
  }
}

@ApiTags('product reviews')
@Controller('products/:slug/reviews')
export class ProductReviewsController {
  constructor(private readonly reviews: ProductReviewsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ProductReviewListDto })
  async list(
    @Param() params: SlugParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<ProductReviewListDto> {
    return await this.reviews.list(params.slug, query);
  }

  @Get('mine')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader({ name: 'X-Review-Token', required: true })
  @ApiOkResponse({ type: OwnProductReviewResponseDto })
  async mine(
    @Param() params: SlugParamDto,
    @Headers('x-review-token') token?: string,
  ): Promise<OwnProductReviewResponseDto> {
    return await this.reviews.mine(params.slug, token);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Review-Token', required: true })
  @ApiOkResponse({ type: OwnProductReviewDto })
  async create(
    @Param() params: SlugParamDto,
    @Headers('x-review-token') token: string | undefined,
    @Body() input: CreateProductReviewDto,
  ): Promise<OwnProductReviewDto> {
    return await this.reviews.create(params.slug, token, input);
  }
}
