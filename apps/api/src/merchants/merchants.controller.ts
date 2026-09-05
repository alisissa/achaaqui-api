import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SlugParamDto } from '../common/dto/slug-param.dto';
import {
  MerchantDetailDto,
  MerchantListResponseDto,
  MerchantOfferListResponseDto,
  MerchantOffersQueryDto,
} from './merchants.dto';
import { MerchantsService } from './merchants.service';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get()
  @ApiOkResponse({ type: MerchantListResponseDto })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<MerchantListResponseDto> {
    return await this.merchantsService.list(query);
  }

  @Get(':slug/offers')
  @ApiOkResponse({ type: MerchantOfferListResponseDto })
  @ApiNotFoundResponse({ description: 'Merchant not found.' })
  async offers(
    @Param() params: SlugParamDto,
    @Query() query: MerchantOffersQueryDto,
  ): Promise<MerchantOfferListResponseDto> {
    return await this.merchantsService.offers(params.slug, query);
  }

  @Get(':slug')
  @ApiOkResponse({ type: MerchantDetailDto })
  @ApiNotFoundResponse({ description: 'Merchant not found.' })
  async detail(@Param() params: SlugParamDto): Promise<MerchantDetailDto> {
    return await this.merchantsService.detail(params.slug);
  }
}
