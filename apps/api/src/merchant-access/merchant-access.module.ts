import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import {
  MerchantAuthController,
  AdminMerchantLoginController,
} from './merchant-access.controller';
import { MerchantAccessService } from './merchant-access.service';
import { MerchantAccessGuard } from './merchant-access.guard';
import { PasswordService } from './password.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [MerchantAuthController, AdminMerchantLoginController],
  providers: [MerchantAccessService, MerchantAccessGuard, PasswordService],
  exports: [MerchantAccessGuard, MerchantAccessService],
})
export class MerchantAccessModule {}
