import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { ActorId } from '../admin-auth/admin-actor';
import { IdParamDto } from '../common/dto/id-param.dto';
import {
  AdminReviewItemDto,
  AdminReviewListResponseDto,
  AdminReviewQueryDto,
  AdminReviewSummaryDto,
  UpdateReviewStatusDto,
} from './reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('admin reviews')
@ApiBearerAuth('admin-key')
@ApiUnauthorizedResponse({ description: 'Administrative access is required.' })
@UseGuards(AdminApiKeyGuard)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('summary')
  @ApiOkResponse({ type: AdminReviewSummaryDto })
  async summary(): Promise<AdminReviewSummaryDto> {
    return await this.reviewsService.adminSummary();
  }

  @Get()
  @ApiOkResponse({ type: AdminReviewListResponseDto })
  async list(
    @Query() query: AdminReviewQueryDto,
  ): Promise<AdminReviewListResponseDto> {
    return await this.reviewsService.adminList(query);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AdminReviewItemDto })
  @ApiNotFoundResponse({ description: 'Review not found.' })
  async moderate(
    @ActorId() actorId: string,
    @Param() params: IdParamDto,
    @Body() input: UpdateReviewStatusDto,
  ): Promise<AdminReviewItemDto> {
    return await this.reviewsService.moderate(params.id, input, actorId);
  }
}
