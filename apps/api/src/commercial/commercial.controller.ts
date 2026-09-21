import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { ActorId } from '../admin-auth/admin-actor';
import { MerchantAccessGuard } from '../merchant-access/merchant-access.guard';
import {
  CurrentMerchant,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommercialChangeDto, HighlightChangeDto } from './commercial.dto';
import { CommercialService } from './commercial.service';

@Controller()
export class PublicCommercialController {
  constructor(private readonly commercial: CommercialService) {}
  @Get('highlights')
  @Header('Cache-Control', 'no-store')
  async highlights(): ReturnType<CommercialService['highlights']> {
    return await this.commercial.highlights();
  }
  @Get('promotions') @Header('Cache-Control', 'no-store') async promotions(
    @Query() query: PaginationQueryDto,
  ): ReturnType<CommercialService['promotions']> {
    return await this.commercial.promotions(query);
  }
}
@Controller('merchant/offers')
@UseGuards(MerchantAccessGuard)
export class MerchantCommercialController {
  constructor(private readonly commercial: CommercialService) {}
  @Patch(':id/commercial') async update(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CommercialChangeDto,
  ): ReturnType<CommercialService['update']> {
    return await this.commercial.update(
      actor.merchantId,
      id,
      input,
      `merchant:${actor.userId}`,
      actor,
    );
  }
}
@Controller('admin/merchants')
@UseGuards(AdminApiKeyGuard)
export class AdminCommercialController {
  constructor(private readonly commercial: CommercialService) {}
  @Get(':merchantId/highlight') async status(
    @Param('merchantId', ParseUUIDPipe) id: string,
  ): ReturnType<CommercialService['merchantHighlight']> {
    return await this.commercial.merchantHighlight(id);
  }
  @Patch(':merchantId/highlight') @HttpCode(204) async merchant(
    @Param('merchantId', ParseUUIDPipe) id: string,
    @Body() input: HighlightChangeDto,
    @ActorId() actorId: string,
  ): Promise<void> {
    await this.commercial.highlightMerchant(id, input, actorId);
  }
  @Patch(':merchantId/offers/:id/highlight') @HttpCode(204) async offer(
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: HighlightChangeDto,
    @ActorId() actorId: string,
  ): Promise<void> {
    await this.commercial.highlightOffer(merchantId, id, input, actorId);
  }
  @Patch(':merchantId/offers/:id/commercial') async update(
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CommercialChangeDto,
    @ActorId() actorId: string,
  ): ReturnType<CommercialService['update']> {
    return await this.commercial.update(merchantId, id, input, actorId);
  }
}
