import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { ReviewsService } from './reviews.service';
import {
  ProductReviewsController,
  ReviewIdentityController,
} from './product-reviews.controller';
import { ProductReviewsService } from './product-reviews.service';
import { ReviewSafetyController } from './review-safety.controller';
import { ReviewSafetyService } from './review-safety.service';
import { ReviewerBansService } from './reviewer-bans.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [
    AdminReviewsController,
    ProductReviewsController,
    ReviewIdentityController,
    ReviewSafetyController,
  ],
  providers: [
    ReviewsService,
    ProductReviewsService,
    ReviewSafetyService,
    ReviewerBansService,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
