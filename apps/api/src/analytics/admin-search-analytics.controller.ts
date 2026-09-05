import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import {
  AdminSearchListResponseDto,
  AdminSearchQueryDto,
  AdminSearchSummaryDto,
} from './search-analytics.dto';
import { SearchAnalyticsService } from './search-analytics.service';

@ApiTags('admin search analytics')
@ApiBearerAuth('admin-key')
@ApiUnauthorizedResponse({ description: 'Administrative access is required.' })
@UseGuards(AdminApiKeyGuard)
@Controller('admin/searches')
export class AdminSearchAnalyticsController {
  constructor(
    private readonly searchAnalyticsService: SearchAnalyticsService,
  ) {}

  @Get('summary')
  @ApiOkResponse({ type: AdminSearchSummaryDto })
  async summary(
    @Query() query: AdminSearchQueryDto,
  ): Promise<AdminSearchSummaryDto> {
    return await this.searchAnalyticsService.adminSummary(query);
  }

  @Get()
  @ApiOkResponse({ type: AdminSearchListResponseDto })
  async list(
    @Query() query: AdminSearchQueryDto,
  ): Promise<AdminSearchListResponseDto> {
    return await this.searchAnalyticsService.adminList(query);
  }

  @Post('retention-cleanup')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Expired search events were removed.' })
  async cleanupExpired(): Promise<{ deleted: number }> {
    return { deleted: await this.searchAnalyticsService.cleanupExpired() };
  }
}
