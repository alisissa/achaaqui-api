import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminMerchantsController } from './admin-merchants.controller';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  imports: [AdminAuthModule, ReviewsModule],
  controllers: [MerchantsController, AdminMerchantsController],
  providers: [MerchantsService],
})
export class MerchantsModule {}
