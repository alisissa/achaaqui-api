import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminMerchantsController } from './admin-merchants.controller';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { MerchantOffersService } from './merchant-offers.service';
import {
  AdminMerchantOffersController,
  AdminCatalogProductsController,
} from './admin-merchant-offers.controller';

@Module({
  imports: [AdminAuthModule, ReviewsModule],
  controllers: [
    MerchantsController,
    AdminMerchantsController,
    AdminMerchantOffersController,
    AdminCatalogProductsController,
  ],
  providers: [MerchantsService, MerchantOffersService],
})
export class MerchantsModule {}
