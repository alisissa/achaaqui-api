import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
  ): Promise<AdminMerchantListResponseDto> {
    return await this.merchantsService.adminList(query);
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
