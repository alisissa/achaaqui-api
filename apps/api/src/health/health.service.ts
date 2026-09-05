import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { HealthResponseDto } from './health.dto';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  live(): HealthResponseDto {
    return this.response();
  }

  async ready(): Promise<HealthResponseDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.response();
    } catch (error: unknown) {
      throw new ServiceUnavailableException('Database is not ready.', {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  private response(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'catalog-api',
      timestamp: new Date().toISOString(),
    };
  }
}
