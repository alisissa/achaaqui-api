import {
  Body,
  Controller,
  Delete,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IdParamDto } from '../common/dto/id-param.dto';
import {
  EmptyReviewSafetyDto,
  ReportReviewDto,
  ReviewSafetyResultDto,
} from './review-safety.dto';
import { ReviewSafetyService } from './review-safety.service';

@Controller('reviews')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class ReviewSafetyController {
  constructor(private readonly safety: ReviewSafetyService) {}

  @Post(':id/report')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async report(
    @Param() params: IdParamDto,
    @Headers('x-review-token') token: string | undefined,
    @Body() input: ReportReviewDto,
  ): Promise<ReviewSafetyResultDto> {
    return await this.safety.save(params.id, token, input);
  }

  @Post(':id/block')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async block(
    @Param() params: IdParamDto,
    @Body() _input: EmptyReviewSafetyDto,
    @Headers('x-review-token') token?: string,
  ): Promise<ReviewSafetyResultDto> {
    return await this.safety.save(params.id, token);
  }

  @Delete('blocks')
  @Header('Cache-Control', 'private, no-store')
  async clear(
    @Body() _input: EmptyReviewSafetyDto,
    @Headers('x-review-token') token?: string,
  ): Promise<ReviewSafetyResultDto> {
    return await this.safety.clearBlocks(token);
  }
}
