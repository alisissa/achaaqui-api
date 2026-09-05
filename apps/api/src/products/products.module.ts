import { Module } from '@nestjs/common';
import { SearchAnalyticsModule } from '../analytics/search-analytics.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [ReviewsModule, SearchAnalyticsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
