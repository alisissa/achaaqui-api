import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminImportsController } from './admin-imports.controller';
import { ImportCommitService } from './import-commit.service';
import { ImportStagingService } from './import-staging.service';
import { ImportsService } from './imports.service';
import { ImportTemplateService } from './import-template.service';
import { MerchantAccessModule } from '../merchant-access/merchant-access.module';
import { PhotoOcrService } from './photo-ocr.service';
import { PhotoImportService } from './photo-import.service';
import { MerchantFileImportsController } from './merchant-file-imports.controller';
import {
  MerchantImportsController,
  PhotoImportGuard,
} from './merchant-imports.controller';

@Module({
  imports: [AdminAuthModule, MerchantAccessModule],
  controllers: [
    AdminImportsController,
    MerchantImportsController,
    MerchantFileImportsController,
  ],
  providers: [
    ImportsService,
    ImportStagingService,
    ImportCommitService,
    ImportTemplateService,
    PhotoOcrService,
    PhotoImportService,
    PhotoImportGuard,
  ],
})
export class ImportsModule {}
