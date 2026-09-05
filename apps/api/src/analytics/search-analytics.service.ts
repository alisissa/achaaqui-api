import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { ClientPlatform, Prisma } from '../generated/prisma/client';
import {
  AdminSearchItemDto,
  AdminSearchListResponseDto,
  AdminSearchQueryDto,
  AdminSearchSummaryDto,
} from './search-analytics.dto';

export interface SearchClientContext {
  platform: ClientPlatform;
  clientVersion: string | null;
  anonymousIdHash: string | null;
  ipHash: string | null;
}

export interface ProductSearchHit {
  productId: string;
  merchantIds: readonly string[];
}

export interface ProductSearchRecord {
  query: string;
  page: number;
  pageSize: number;
  resultCount: number;
  hits: readonly ProductSearchHit[];
  context: SearchClientContext;
}

function normalizedQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function platformFromRequest(request: Request): ClientPlatform {
  const explicit = request.header('x-client-platform')?.toLowerCase();
  if (explicit === 'ios') {
    return ClientPlatform.IOS;
  }
  if (explicit === 'android') {
    return ClientPlatform.ANDROID;
  }
  if (explicit === 'web') {
    return ClientPlatform.WEB;
  }

  const userAgent = request.header('user-agent')?.toLowerCase() ?? '';
  if (userAgent.includes('android')) {
    return ClientPlatform.ANDROID;
  }
  if (
    userAgent.includes('iphone') ||
    userAgent.includes('ipad') ||
    userAgent.includes('ios')
  ) {
    return ClientPlatform.IOS;
  }
  if (userAgent.includes('mozilla')) {
    return ClientPlatform.WEB;
  }

  return ClientPlatform.UNKNOWN;
}

interface MerchantCountRow {
  merchantId: string;
  productImpressions: bigint;
  searchCount: bigint;
}

@Injectable()
export class SearchAnalyticsService {
  private readonly hashKey: string;
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.hashKey = configService.get<string>('ANALYTICS_HASH_KEY', '');
    this.retentionDays = configService.get<number>(
      'ANALYTICS_RETENTION_DAYS',
      90,
    );
  }

  async cleanupExpired(): Promise<number> {
    const expiresBefore = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const deleted = await this.prisma.searchEvent.deleteMany({
      where: { createdAt: { lt: expiresBefore } },
    });
    return deleted.count;
  }

  contextFromRequest(request: Request): SearchClientContext {
    const clientVersion = request.header('x-client-version')?.trim();
    const anonymousId = request.header('x-anonymous-id')?.trim();
    const ipAddress = request.ip?.trim();

    return {
      platform: platformFromRequest(request),
      clientVersion:
        clientVersion && clientVersion.length <= 40 ? clientVersion : null,
      anonymousIdHash:
        anonymousId && anonymousId.length <= 128
          ? this.hashValue(anonymousId)
          : null,
      ipHash:
        ipAddress && ipAddress.length <= 64 ? this.hashValue(ipAddress) : null,
    };
  }

  async recordProductSearch(input: ProductSearchRecord): Promise<void> {
    const hits = new Map<string, { merchantId: string; productId: string }>();
    for (const product of input.hits) {
      for (const merchantId of product.merchantIds) {
        hits.set(`${merchantId}:${product.productId}`, {
          merchantId,
          productId: product.productId,
        });
      }
    }

    await this.prisma.searchEvent.create({
      data: {
        query: input.query.trim(),
        normalizedQuery: normalizedQuery(input.query),
        platform: input.context.platform,
        clientVersion: input.context.clientVersion,
        anonymousIdHash: input.context.anonymousIdHash,
        ipHash: input.context.ipHash,
        resultCount: input.resultCount,
        page: input.page,
        pageSize: input.pageSize,
        merchantHits: { create: [...hits.values()] },
      },
      select: { id: true },
    });
  }

  async adminList(
    query: AdminSearchQueryDto,
  ): Promise<AdminSearchListResponseDto> {
    const where = this.adminWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [total, searches] = await Promise.all([
      this.prisma.searchEvent.count({ where }),
      this.prisma.searchEvent.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          query: true,
          platform: true,
          clientVersion: true,
          countryCode: true,
          anonymousIdHash: true,
          ipHash: true,
          resultCount: true,
          page: true,
          pageSize: true,
          createdAt: true,
          merchantHits: {
            select: {
              merchant: { select: { id: true, slug: true, name: true } },
              product: { select: { id: true, slug: true, name: true } },
            },
          },
        },
      }),
    ]);
    const items: AdminSearchItemDto[] = searches.map((search) => ({
      id: search.id,
      query: search.query,
      platform: search.platform,
      clientVersion: search.clientVersion,
      countryCode: search.countryCode,
      resultCount: search.resultCount,
      page: search.page,
      pageSize: search.pageSize,
      anonymousVisitor: Boolean(search.anonymousIdHash ?? search.ipHash),
      createdAt: search.createdAt.toISOString(),
      hits: search.merchantHits,
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async adminSummary(
    query: AdminSearchQueryDto,
  ): Promise<AdminSearchSummaryDto> {
    const where = this.adminWhere(query);
    const startDate = this.startDate(query.days);
    const [
      totalSearches,
      identities,
      platformGroups,
      queryGroups,
      merchantGroups,
    ] =
      await Promise.all([
        this.prisma.searchEvent.count({ where }),
        this.prisma.searchEvent.findMany({
          where: {
            ...where,
            OR: [{ anonymousIdHash: { not: null } }, { ipHash: { not: null } }],
          },
          select: { anonymousIdHash: true, ipHash: true },
          distinct: ['anonymousIdHash', 'ipHash'],
        }),
        this.prisma.searchEvent.groupBy({
          by: ['platform'],
          where,
          _count: { _all: true },
        }),
        this.prisma.searchEvent.groupBy({
          by: ['normalizedQuery'],
          where,
          _count: { _all: true },
          orderBy: { _count: { normalizedQuery: 'desc' } },
          take: 8,
        }),
        this.merchantCountRows(query, startDate),
      ]);

    const visitors = new Set(
      identities.map((identity) =>
        identity.anonymousIdHash
          ? `anonymous:${identity.anonymousIdHash}`
          : `ip:${identity.ipHash ?? ''}`,
      ),
    );
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantGroups.map((group) => group.merchantId) } },
      select: { id: true, slug: true, name: true },
    });
    const merchantsById = new Map(
      merchants.map((merchant) => [merchant.id, merchant]),
    );

    return {
      days: query.days,
      totalSearches,
      uniqueVisitorEstimate: visitors.size,
      platformCounts: platformGroups.map((group) => ({
        label: group.platform,
        count: group._count._all,
      })),
      topQueries: queryGroups.map((group) => ({
        label: group.normalizedQuery,
        count: group._count._all,
      })),
      merchantCounts: merchantGroups
        .flatMap((group) => {
          const merchant = merchantsById.get(group.merchantId);
          return merchant
            ? [{
                merchant,
                searchCount: Number(group.searchCount),
                productImpressions: Number(group.productImpressions),
              }]
            : [];
        })
        .sort(
          (first, second) =>
            second.searchCount - first.searchCount ||
            second.productImpressions - first.productImpressions,
        ),
    };
  }

  private adminWhere(query: AdminSearchQueryDto): Prisma.SearchEventWhereInput {
    return {
      createdAt: { gte: this.startDate(query.days) },
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.merchantId
        ? { merchantHits: { some: { merchantId: query.merchantId } } }
        : {}),
      ...(query.q
        ? {
            normalizedQuery: {
              contains: normalizedQuery(query.q),
            },
          }
        : {}),
    };
  }

  private startDate(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async merchantCountRows(
    query: AdminSearchQueryDto,
    startDate: Date,
  ): Promise<MerchantCountRow[]> {
    const conditions = [Prisma.sql`event."createdAt" >= ${startDate}`];
    if (query.platform) {
      conditions.push(
        Prisma.sql`event."platform" = ${query.platform}::"ClientPlatform"`,
      );
    }
    if (query.q) {
      conditions.push(
        Prisma.sql`event."normalizedQuery" LIKE ${`%${normalizedQuery(query.q)}%`}`,
      );
    }
    if (query.merchantId) {
      conditions.push(Prisma.sql`hit."merchantId" = ${query.merchantId}::uuid`);
    }

    return await this.prisma.$queryRaw<MerchantCountRow[]>(Prisma.sql`
      SELECT
        hit."merchantId" AS "merchantId",
        COUNT(*) AS "productImpressions",
        COUNT(DISTINCT hit."searchEventId") AS "searchCount"
      FROM "SearchMerchantHit" AS hit
      INNER JOIN "SearchEvent" AS event ON event."id" = hit."searchEventId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY hit."merchantId"
    `);
  }

  private hashValue(value: string): string {
    return createHmac('sha256', this.hashKey).update(value).digest('hex');
  }
}
