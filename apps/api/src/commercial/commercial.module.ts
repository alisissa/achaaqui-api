import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MerchantAccessModule } from '../merchant-access/merchant-access.module';
import { CommercialService } from './commercial.service';
import {
  AdminCommercialController,
  MerchantCommercialController,
  PublicCommercialController,
} from './commercial.controller';
@Module({
  imports: [AdminAuthModule, MerchantAccessModule],
  controllers: [
    AdminCommercialController,
    MerchantCommercialController,
    PublicCommercialController,
  ],
  providers: [CommercialService],
})
export class CommercialModule {}
