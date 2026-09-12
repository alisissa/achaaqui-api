import { Injectable, NotFoundException } from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { Prisma, ReviewStatus } from '../generated/prisma/client';
import {
  AdminReviewItemDto,
  AdminReviewListResponseDto,
  AdminReviewQueryDto,
  AdminReviewSummaryDto,
  RatingSummaryDto,
  UpdateReviewStatusDto,
} from './reviews.dto';

interface RatingAccumulator {
  total: number;
  count: number;
}

function roundedAverage(total: number, count: number): number | null {
  return count === 0 ? null : Math.round((total / count) * 100) / 100;
}

function toRatingMap(
  ratings: Map<string, RatingAccumulator>,
): Map<string, RatingSummaryDto> {
  return new Map(
    [...ratings.entries()].map(([key, value]) => [
      key,
      {
        average: roundedAverage(value.total, value.count),
        count: value.count,
      },
    ]),
  );
}

export function combineRatings(
  productRating: number | null,
  merchantRating: number | null,
): number | null {
  if (productRating === null || merchantRating === null) return null;

  return Math.round(((productRating + merchantRating) / 2) * 100) / 100;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async productRatings(
    productIds: readonly string[],
  ): Promise<Map<string, RatingSummaryDto>> {
    if (productIds.length === 0) {
      return new Map();
    }

    const offers = await this.prisma.merchantProduct.findMany({
      where: { productId: { in: [...productIds] } },
      select: { id: true, productId: true },
    });
    const productByOffer = new Map(
      offers.map((offer) => [offer.id, offer.productId]),
    );
    if (offers.length === 0) return new Map();
    const reviews = await this.prisma.customerReview.groupBy({
      by: ['merchantProductId'],
      where: {
        status: ReviewStatus.PUBLISHED,
        merchantProductId: { in: offers.map((offer) => offer.id) },
      },
      _avg: { productRating: true },
      _count: { _all: true },
    });
    const ratings = new Map<string, RatingAccumulator>();
    for (const review of reviews) {
      const productId = productByOffer.get(review.merchantProductId);
      if (!productId || review._avg.productRating === null) continue;
      const current = ratings.get(productId) ?? { total: 0, count: 0 };
      current.total += review._avg.productRating * review._count._all;
      current.count += review._count._all;
      ratings.set(productId, current);
    }

    return toRatingMap(ratings);
  }

  async merchantRatings(
    merchantIds: readonly string[],
  ): Promise<Map<string, RatingSummaryDto>> {
    if (merchantIds.length === 0) {
      return new Map();
    }

    const offers = await this.prisma.merchantProduct.findMany({
      where: { merchantId: { in: [...merchantIds] } },
      select: { id: true, merchantId: true },
    });
    const merchantByOffer = new Map(
      offers.map((offer) => [offer.id, offer.merchantId]),
    );
    if (offers.length === 0) return new Map();
    const reviews = await this.prisma.customerReview.groupBy({
      by: ['merchantProductId'],
      where: {
        status: ReviewStatus.PUBLISHED,
        merchantProductId: { in: offers.map((offer) => offer.id) },
      },
      _avg: { merchantRating: true },
      _count: { _all: true },
    });
    const ratings = new Map<string, RatingAccumulator>();
    for (const review of reviews) {
      const merchantId = merchantByOffer.get(review.merchantProductId);
      if (!merchantId || review._avg.merchantRating === null) continue;
      const current = ratings.get(merchantId) ?? { total: 0, count: 0 };
      current.total += review._avg.merchantRating * review._count._all;
      current.count += review._count._all;
    }

    return toRatingMap(ratings);
  }

  async adminList(
    query: AdminReviewQueryDto,
  ): Promise<AdminReviewListResponseDto> {
    const search = query.q?.trim();
    const where: Prisma.CustomerReviewWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.merchantId
        ? { merchantProduct: { merchantId: query.merchantId } }
        : {}),
      ...(search
        ? {
            OR: [
              {
                reviewerDisplayName: { contains: search, mode: 'insensitive' },
              },
              { title: { contains: search, mode: 'insensitive' } },
              { comment: { contains: search, mode: 'insensitive' } },
              {
                merchantProduct: {
                  merchant: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                merchantProduct: {
                  product: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, reviews] = await Promise.all([
      this.prisma.customerReview.count({ where }),
      this.prisma.customerReview.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          productRating: true,
          merchantRating: true,
          reviewerDisplayName: true,
          title: true,
          comment: true,
          status: true,
          createdAt: true,
          moderatedAt: true,
          merchantProduct: {
            select: {
              merchant: { select: { id: true, slug: true, name: true } },
              product: { select: { id: true, slug: true, name: true } },
            },
          },
        },
      }),
    ]);
    const items: AdminReviewItemDto[] = reviews.map((review) => ({
      id: review.id,
      productRating: review.productRating,
      merchantRating: review.merchantRating,
      combinedRating:
        combineRatings(review.productRating, review.merchantRating) ?? 0,
      reviewerDisplayName: review.reviewerDisplayName,
      title: review.title,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      merchant: review.merchantProduct.merchant,
      product: review.merchantProduct.product,
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async adminSummary(): Promise<AdminReviewSummaryDto> {
    const [statusGroups, published] = await Promise.all([
      this.prisma.customerReview.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.customerReview.aggregate({
        where: { status: ReviewStatus.PUBLISHED },
        _avg: { productRating: true, merchantRating: true },
        _count: { _all: true },
      }),
    ]);
    const statusCounts = statusGroups.map((group) => ({
      status: group.status,
      count: group._count._all,
    }));
    const total = statusCounts.reduce((sum, group) => sum + group.count, 0);
    const pending =
      statusCounts.find((group) => group.status === ReviewStatus.PENDING)
        ?.count ?? 0;

    return {
      total,
      pending,
      statusCounts,
      publishedProductRating: {
        average:
          published._avg.productRating === null
            ? null
            : Math.round(published._avg.productRating * 100) / 100,
        count: published._count._all,
      },
      publishedMerchantRating: {
        average:
          published._avg.merchantRating === null
            ? null
            : Math.round(published._avg.merchantRating * 100) / 100,
        count: published._count._all,
      },
    };
  }

  async moderate(
    id: string,
    input: UpdateReviewStatusDto,
    actorId = 'local-admin',
  ): Promise<AdminReviewItemDto> {
    const existing = await this.prisma.customerReview.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Review not found.');
    }

    const pending = input.status === ReviewStatus.PENDING;
    const review = await this.prisma.customerReview.update({
      where: { id },
      data: {
        status: input.status,
        moderatedAt: pending ? null : new Date(),
        moderatedBy: pending ? null : actorId,
      },
      select: {
        id: true,
        productRating: true,
        merchantRating: true,
        reviewerDisplayName: true,
        title: true,
        comment: true,
        status: true,
        createdAt: true,
        moderatedAt: true,
        merchantProduct: {
          select: {
            merchant: { select: { id: true, slug: true, name: true } },
            product: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    return {
      id: review.id,
      productRating: review.productRating,
      merchantRating: review.merchantRating,
      combinedRating:
        combineRatings(review.productRating, review.merchantRating) ?? 0,
      reviewerDisplayName: review.reviewerDisplayName,
      title: review.title,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      merchant: review.merchantProduct.merchant,
      product: review.merchantProduct.product,
    };
  }
}
