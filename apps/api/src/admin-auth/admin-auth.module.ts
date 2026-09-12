import { Module } from '@nestjs/common';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { FirebaseAdminAuthService } from './firebase-admin-auth.service';

@Module({
  providers: [AdminApiKeyGuard, FirebaseAdminAuthService],
  exports: [AdminApiKeyGuard, FirebaseAdminAuthService],
})
export class AdminAuthModule {}
