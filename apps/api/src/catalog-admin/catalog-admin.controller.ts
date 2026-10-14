import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminApiKeyGuard } from '../admin-auth/admin-api-key.guard';
import { ActorId } from '../admin-auth/admin-actor';
import { CatalogAdminService } from './catalog-admin.service';
import {
  CatalogImageParam,
  CatalogProductParam,
  CreateCatalogCategory,
  UpdateCatalogPresentation,
  type CatalogPresentation,
} from './catalog-admin.dto';
import { CATALOG_IMAGE_MAX_BYTES, type CatalogUpload } from './catalog-image';

const uploadLimits = {
  fileSize: CATALOG_IMAGE_MAX_BYTES,
  files: 1,
  fields: 4,
  fieldSize: 1024,
  fieldNameSize: 64,
  parts: 5,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

@ApiTags('admin catalog presentation')
@ApiBearerAuth('admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/catalog')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}

  @Get('products/:productId/presentation')
  async detail(
    @Param() params: CatalogProductParam,
  ): Promise<CatalogPresentation> {
    return await this.catalog.detail(params.productId);
  }

  @Post('products/:productId/presentation')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedUpdatedAt', 'categoryId', 'altText', 'confirmed'],
      properties: {
        expectedUpdatedAt: { type: 'string', format: 'date-time' },
        categoryId: { type: 'string', format: 'uuid' },
        altText: { type: 'string', maxLength: 240 },
        confirmed: { type: 'string', enum: ['true'] },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image', { limits: uploadLimits }))
  async update(
    @Param() params: CatalogProductParam,
    @Body() input: UpdateCatalogPresentation,
    @UploadedFile() file: CatalogUpload | undefined,
    @ActorId() actor: string,
  ): Promise<CatalogPresentation> {
    return await this.catalog.update(params.productId, input, file, actor);
  }

  @Post('categories')
  async category(
    @Body() input: CreateCatalogCategory,
    @ActorId() actor: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    return await this.catalog.category(input, actor);
  }
}

@Controller('catalog-images')
export class CatalogImagesController {
  constructor(private readonly catalog: CatalogAdminService) {}
  @Get(':filename')
  async image(
    @Param() params: CatalogImageParam,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.catalog.image(params.filename);
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .send(bytes);
  }
}
