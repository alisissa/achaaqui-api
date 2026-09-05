import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { IdParamDto } from '../common/dto/id-param.dto';
import { ImportCommitService } from './import-commit.service';
import {
  ImportStagingService,
  type UploadedCsvFile,
} from './import-staging.service';
import {
  AdminImportDetailDto,
  AdminImportListResponseDto,
  AdminImportQueryDto,
  CommitImportDto,
  UploadCsvDto,
} from './imports.dto';
import { ImportsService } from './imports.service';

@ApiTags('admin imports')
@ApiBearerAuth('admin-key')
@ApiUnauthorizedResponse({ description: 'Administrative access is required.' })
@UseGuards(AdminApiKeyGuard)
@Controller('admin/imports')
export class AdminImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly stagingService: ImportStagingService,
    private readonly commitService: ImportCommitService,
  ) {}

  @Post('csv')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 2_097_152 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: AdminImportDetailDto })
  async uploadCsv(
    @Body() input: UploadCsvDto,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    const id = await this.stagingService.stageCsv(input, file);
    return await this.importsService.detail(id);
  }

  @Get()
  @ApiOkResponse({ type: AdminImportListResponseDto })
  async list(
    @Query() query: AdminImportQueryDto,
  ): Promise<AdminImportListResponseDto> {
    return await this.importsService.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminImportDetailDto })
  async detail(@Param() params: IdParamDto): Promise<AdminImportDetailDto> {
    return await this.importsService.detail(params.id);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminImportDetailDto })
  async commit(
    @Param() params: IdParamDto,
    @Body() input: CommitImportDto,
  ): Promise<AdminImportDetailDto> {
    await this.commitService.commit(params.id, input);
    return await this.importsService.detail(params.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminImportDetailDto })
  async cancel(@Param() params: IdParamDto): Promise<AdminImportDetailDto> {
    await this.importsService.cancel(params.id);
    return await this.importsService.detail(params.id);
  }
}
