import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured.');
    }

    super({
      adapter: new PrismaPg({
        connectionString,
        max: configService.get<number>('DATABASE_POOL_MAX', 10),
        connectionTimeoutMillis: configService.get<number>(
          'DATABASE_CONNECTION_TIMEOUT_MS',
          10_000,
        ),
        idleTimeoutMillis: configService.get<number>(
          'DATABASE_IDLE_TIMEOUT_MS',
          10_000,
        ),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
