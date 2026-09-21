import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MerchantAccessGuard } from '../merchant-access/merchant-access.guard';
import {
  CurrentMerchant,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import {
  ImportStagingService,
  type UploadedCsvFile,
} from './import-staging.service';
import { PhotoImportService } from './photo-import.service';
import {
  CommitMerchantImportDto,
  PhotoPreviewVersionDto,
  ResolvePhotoRowDto,
} from './photo-import.dto';
import type { AdminImportDetailDto } from './imports.dto';
import { MAX_IMPORT_BYTES } from './import-file';

const fileUpload = FileInterceptor('file', {
  limits: {
    fileSize: MAX_IMPORT_BYTES,
    files: 1,
    fields: 0,
    parts: 2,
    fieldNameSize: 64,
  },
});

@Controller('merchant/file-imports')
@UseGuards(MerchantAccessGuard)
export class MerchantFileImportsController {
  constructor(
    private readonly staging: ImportStagingService,
    private readonly imports: PhotoImportService,
  ) {}

  @Post('csv')
  @UseInterceptors(fileUpload)
  async csv(
    @CurrentMerchant() actor: MerchantActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    const id = await this.staging.stageMerchantFile(actor, file, 'CSV');
    return await this.imports.detail(actor, id, 'file');
  }
  @Post('xlsx')
  @UseInterceptors(fileUpload)
  async xlsx(
    @CurrentMerchant() actor: MerchantActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    const id = await this.staging.stageMerchantFile(actor, file, 'XLSX');
    return await this.imports.detail(actor, id, 'file');
  }
  @Get()
  async list(
    @CurrentMerchant() actor: MerchantActor,
  ): Promise<{ items: Awaited<ReturnType<PhotoImportService['list']>> }> {
    return { items: await this.imports.list(actor, 'file') };
  }
  @Get(':id')
  async detail(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminImportDetailDto> {
    return await this.imports.detail(actor, id, 'file');
  }
  @Patch(':id/rows/:rowId')
  async resolve(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() input: ResolvePhotoRowDto,
  ): Promise<AdminImportDetailDto> {
    return await this.imports.resolve(actor, id, rowId, input, 'file');
  }
  @Post(':id/commit')
  async commit(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CommitMerchantImportDto,
  ): Promise<AdminImportDetailDto> {
    return await this.imports.commit(actor, id, input, 'file');
  }
  @Post(':id/cancel')
  async cancel(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PhotoPreviewVersionDto,
  ): Promise<{ cancelled: boolean }> {
    await this.imports.cancel(actor, id, input.expectedPreviewToken, 'file');
    return { cancelled: true };
  }
  @Post(':id/remaining')
  async remaining(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminImportDetailDto> {
    return await this.imports.remaining(actor, id, 'file');
  }
}
