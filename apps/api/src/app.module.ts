import { Module } from '@nestjs/common';
import { CatalogAdminModule } from './catalog-admin/catalog-admin.module';
import { CommercialModule } from './commercial/commercial.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CategoriesModule } from './categories/categories.module';
import { SearchAnalyticsModule } from './analytics/search-analytics.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { FreshnessModule } from './common/freshness/freshness.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { MerchantsModule } from './merchants/merchants.module';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AdminProductsModule } from './admin-products/admin-products.module';

@Module({
  imports: [
    CatalogAdminModule,
    CommercialModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    FreshnessModule,
    HealthModule,
    ImportsModule,
    SearchAnalyticsModule,
    ReviewsModule,
    AdminProductsModule,
    CategoriesModule,
    ProductsModule,
    MerchantsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
