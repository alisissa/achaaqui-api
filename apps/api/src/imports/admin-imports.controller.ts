import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
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
import { ActorId } from '../admin-auth/admin-actor';
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
  ImportTemplateQueryDto,
} from './imports.dto';
import { ImportTemplateService } from './import-template.service';
import { ImportsService } from './imports.service';
import { IMPORT_UPLOAD_OPTIONS } from './import-upload-options';

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
    private readonly templateService: ImportTemplateService,
  ) {}

  @Get('template')
  async template(
    @Query() query: ImportTemplateQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.templateService.download(query);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Post('xlsx')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: AdminImportDetailDto })
  async uploadXlsx(
    @ActorId() actorId: string,
    @Body() input: UploadCsvDto,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    const id = await this.stagingService.stageXlsx(input, file, actorId);
    return await this.importsService.detail(id);
  }

  @Post('csv')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: AdminImportDetailDto })
  async uploadCsv(
    @ActorId() actorId: string,
    @Body() input: UploadCsvDto,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    const id = await this.stagingService.stageCsv(input, file, actorId);
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
    @ActorId() actorId: string,
    @Param() params: IdParamDto,
    @Body() input: CommitImportDto,
  ): Promise<AdminImportDetailDto> {
    await this.commitService.commit(params.id, input, actorId);
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
