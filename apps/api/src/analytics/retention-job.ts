import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { SearchAnalyticsService } from './search-analytics.service';

// A one-shot, non-HTTP entrypoint for Cloud Run Jobs. Never loads local .env files.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (env: Record<string, unknown>) => {
        if (
          typeof env.DATABASE_URL !== 'string' ||
          !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)
        )
          throw new Error('DATABASE_URL is required.');
        if (env.RETENTION_JOB_ENABLED !== 'true')
          throw new Error('Retention job is not enabled.');
        return {
          ...env,
          DATABASE_POOL_MAX: 1,
          DATABASE_CONNECTION_TIMEOUT_MS: 10000,
          DATABASE_IDLE_TIMEOUT_MS: 1000,
          ANALYTICS_RETENTION_DAYS: 90,
        };
      },
    }),
    DatabaseModule,
  ],
  providers: [SearchAnalyticsService],
})
class RetentionJobModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(RetentionJobModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const analyticsDeleted = await app
      .get(SearchAnalyticsService)
      .cleanupExpired();
    const receipts = await app
      .get(PrismaService)
      .reviewDeletionReceipt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
      });
    console.log(
      JSON.stringify({
        event: 'retention_cleanup',
        analyticsDeleted,
        receiptsDeleted: receipts.count,
      }),
    );
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  // Database error objects may contain credentials or queries. Fail the job without them.
  console.error(
    'Retention cleanup failed. Check configuration and database availability.',
  );
  process.exitCode = 1;
});
