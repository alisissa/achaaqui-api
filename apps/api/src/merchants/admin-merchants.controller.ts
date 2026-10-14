import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActorId } from '../admin-auth/admin-actor';
import { IdParamDto } from '../common/dto/id-param.dto';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import {
  AdminMerchantItemDto,
  AdminMerchantListResponseDto,
  AdminMerchantQueryDto,
  CreateMerchantDto,
  DeleteMerchantDto,
} from './merchants.dto';
import { MerchantsService } from './merchants.service';

@ApiTags('admin merchants')
@ApiBearerAuth('admin-key')
@ApiUnauthorizedResponse({ description: 'Administrative access is required.' })
@UseGuards(AdminApiKeyGuard)
@Controller('admin/merchants')
export class AdminMerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get()
  @ApiOkResponse({ type: AdminMerchantListResponseDto })
  async list(
    @Query() query: AdminMerchantQueryDto,
    @ActorId() actorId: string,
  ): Promise<AdminMerchantListResponseDto> {
    return await this.merchantsService.adminList(query, actorId);
  }

  // Soft delete, restricted to the owner account (MERCHANT_DELETE_ACTOR_IDS).
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param() params: IdParamDto,
    @Body() _input: DeleteMerchantDto,
    @ActorId() actorId: string,
  ): Promise<void> {
    await this.merchantsService.softDelete(params.id, actorId);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminMerchantItemDto })
  @ApiConflictResponse({ description: 'Merchant name or slug already exists.' })
  async create(
    @Body() input: CreateMerchantDto,
  ): Promise<AdminMerchantItemDto> {
    return await this.merchantsService.create(input);
  }
}
