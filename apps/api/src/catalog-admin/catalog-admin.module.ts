import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import {
  CatalogAdminController,
  CatalogImagesController,
} from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogImageStorage } from './catalog-image-storage';

@Module({
  imports: [AdminAuthModule],
  controllers: [CatalogAdminController, CatalogImagesController],
  providers: [CatalogAdminService, CatalogImageStorage],
})
export class CatalogAdminModule {}
