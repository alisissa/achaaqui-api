import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminSearchAnalyticsController } from './admin-search-analytics.controller';
import { SearchAnalyticsService } from './search-analytics.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSearchAnalyticsController],
  providers: [SearchAnalyticsService],
  exports: [SearchAnalyticsService],
})
export class SearchAnalyticsModule {}
