import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { ReviewsService } from './reviews.service';
import {
  ProductReviewsController,
  ReviewIdentityController,
} from './product-reviews.controller';
import { ProductReviewsService } from './product-reviews.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [
    AdminReviewsController,
    ProductReviewsController,
    ReviewIdentityController,
  ],
  providers: [ReviewsService, ProductReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
