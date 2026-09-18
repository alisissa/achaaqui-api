import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type CanActivate,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MerchantAccessGuard } from '../merchant-access/merchant-access.guard';
import {
  CurrentMerchant,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import { PhotoImportService } from './photo-import.service';
import {
  CommitPhotoImportDto,
  PhotoPreviewVersionDto,
  ResolvePhotoRowDto,
} from './photo-import.dto';
import { PHOTO_MAX_BYTES } from './photo-ocr.service';
import type { UploadedCsvFile } from './import-staging.service';
import type { AdminImportDetailDto } from './imports.dto';

@Injectable()
export class PhotoImportGuard implements CanActivate {
  constructor(private readonly photos: PhotoImportService) {}
  canActivate(): boolean {
    this.photos.requireEnabled();
    return true;
  }
}
@Controller('merchant/imports')
@UseGuards(MerchantAccessGuard, PhotoImportGuard)
export class MerchantImportsController {
  constructor(private readonly photos: PhotoImportService) {}

  @Post('photo')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: PHOTO_MAX_BYTES,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 64,
      },
    }),
  )
  async upload(
    @CurrentMerchant() actor: MerchantActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    return await this.photos.upload(actor, file);
  }
  @Get()
  async list(
    @CurrentMerchant() actor: MerchantActor,
  ): Promise<{ items: Awaited<ReturnType<PhotoImportService['list']>> }> {
    return { items: await this.photos.list(actor) };
  }
  @Get(':id')
  async detail(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminImportDetailDto> {
    return await this.photos.detail(actor, id);
  }
  @Patch(':id/rows/:rowId')
  async resolve(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() input: ResolvePhotoRowDto,
  ): Promise<AdminImportDetailDto> {
    return await this.photos.resolve(actor, id, rowId, input);
  }
  @Post(':id/commit')
  async commit(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CommitPhotoImportDto,
  ): Promise<AdminImportDetailDto> {
    return await this.photos.commit(actor, id, input);
  }
  @Post(':id/cancel')
  async cancel(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PhotoPreviewVersionDto,
  ): Promise<{ cancelled: boolean }> {
    await this.photos.cancel(actor, id, input.expectedPreviewToken);
    return { cancelled: true };
  }
  @Post(':id/remaining')
  async remaining(
    @CurrentMerchant() actor: MerchantActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminImportDetailDto> {
    return await this.photos.remaining(actor, id);
  }
}
