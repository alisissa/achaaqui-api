import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { ActorId } from '../admin-auth/admin-actor';
import {
  AdminOfferDto,
  AdminOfferListDto,
  CreateMerchantOfferDto,
  MerchantIdParamDto,
  MerchantOfferParamDto,
  OfferQueryDto,
  RemoveMerchantOfferDto,
  UpdateMerchantOfferDto,
  CatalogProductChoiceListDto,
} from './merchant-offers.dto';
import { MerchantOffersService } from './merchant-offers.service';

@ApiTags('admin merchant offers')
@ApiBearerAuth('admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/merchants/:merchantId/offers')
export class AdminMerchantOffersController {
  constructor(private readonly offers: MerchantOffersService) {}

  @Get()
  @ApiOkResponse({ type: AdminOfferListDto })
  async list(
    @Param() params: MerchantIdParamDto,
    @Query() query: OfferQueryDto,
  ): Promise<AdminOfferListDto> {
    return await this.offers.list(params.merchantId, query);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminOfferDto })
  async create(
    @ActorId() actorId: string,
    @Param() params: MerchantIdParamDto,
    @Body() input: CreateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.create(params.merchantId, input, actorId);
  }

  @Get(':offerId')
  @ApiOkResponse({ type: AdminOfferDto })
  async detail(@Param() params: MerchantOfferParamDto): Promise<AdminOfferDto> {
    return await this.offers.detail(params.merchantId, params.offerId);
  }

  @Patch(':offerId')
  @ApiOkResponse({ type: AdminOfferDto })
  async update(
    @ActorId() actorId: string,
    @Param() params: MerchantOfferParamDto,
    @Body() input: UpdateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.update(
      params.merchantId,
      params.offerId,
      input,
      actorId,
    );
  }

  @Delete(':offerId')
  @ApiOkResponse({ type: AdminOfferDto })
  async remove(
    @Param() params: MerchantOfferParamDto,
    @Body() input: RemoveMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.remove(params.merchantId, params.offerId, input);
  }
}

@ApiTags('admin catalog')
@ApiBearerAuth('admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/catalog/products')
export class AdminCatalogProductsController {
  constructor(private readonly offers: MerchantOffersService) {}

  @Get()
  @ApiOkResponse({ type: CatalogProductChoiceListDto })
  async list(
    @Query() query: OfferQueryDto,
  ): Promise<CatalogProductChoiceListDto> {
    return await this.offers.products(query);
  }
}
