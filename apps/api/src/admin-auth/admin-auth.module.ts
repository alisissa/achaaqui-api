import { Module } from '@nestjs/common';
import { AdminApiKeyGuard } from './admin-api-key.guard';

@Module({
  providers: [AdminApiKeyGuard],
  exports: [AdminApiKeyGuard],
})
export class AdminAuthModule {}
