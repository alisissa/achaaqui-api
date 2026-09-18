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
import { ApiExcludeController } from '@nestjs/swagger';
import {
  CurrentMerchant,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import { OwnOfferParamDto } from '../merchant-access/merchant-access.dto';
import { MerchantAccessGuard } from '../merchant-access/merchant-access.guard';
import { MerchantOffersService } from './merchant-offers.service';
import {
  AdminOfferDto,
  AdminOfferListDto,
  CatalogProductChoiceListDto,
  CreateMerchantOfferDto,
  OfferQueryDto,
  RemoveMerchantOfferDto,
  UpdateMerchantOfferDto,
} from './merchant-offers.dto';

// Never take a merchant ID or actor ID from a route/body/query here.
@ApiExcludeController()
@UseGuards(MerchantAccessGuard)
@Controller('merchant')
export class MerchantSelfServiceController {
  constructor(private readonly offers: MerchantOffersService) {}

  @Get('offers')
  async list(
    @CurrentMerchant() actor: MerchantActor,
    @Query() query: OfferQueryDto,
  ): Promise<AdminOfferListDto> {
    return await this.offers.list(actor.merchantId, query);
  }

  @Get('catalog/products')
  async products(
    @Query() query: OfferQueryDto,
  ): Promise<CatalogProductChoiceListDto> {
    return await this.offers.products(query);
  }

  @Get('offers/:offerId')
  async detail(
    @CurrentMerchant() actor: MerchantActor,
    @Param() params: OwnOfferParamDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.detail(actor.merchantId, params.offerId);
  }

  @Post('offers')
  async create(
    @CurrentMerchant() actor: MerchantActor,
    @Body() input: CreateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.create(
      actor.merchantId,
      input,
      `merchant:${actor.userId}`,
      actor,
    );
  }

  @Patch('offers/:offerId')
  async update(
    @CurrentMerchant() actor: MerchantActor,
    @Param() params: OwnOfferParamDto,
    @Body() input: UpdateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.update(
      actor.merchantId,
      params.offerId,
      input,
      `merchant:${actor.userId}`,
      actor,
    );
  }

  @Delete('offers/:offerId')
  async remove(
    @CurrentMerchant() actor: MerchantActor,
    @Param() params: OwnOfferParamDto,
    @Body() input: RemoveMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    return await this.offers.remove(
      actor.merchantId,
      params.offerId,
      input,
      `merchant:${actor.userId}`,
      actor,
    );
  }
}
