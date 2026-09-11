import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminImportsController } from './admin-imports.controller';
import { ImportCommitService } from './import-commit.service';
import { ImportStagingService } from './import-staging.service';
import { ImportsService } from './imports.service';
import { ImportTemplateService } from './import-template.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminImportsController],
  providers: [
    ImportsService,
    ImportStagingService,
    ImportCommitService,
    ImportTemplateService,
  ],
})
export class ImportsModule {}
