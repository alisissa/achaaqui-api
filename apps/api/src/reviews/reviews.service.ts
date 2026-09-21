import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { Prisma, ReviewStatus } from '../generated/prisma/client';
import { assertAcceptableComment } from './comment-filter';
import { assertReviewerCanPost } from './reviewer-bans.service';
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
      const productId = review.merchantProductId
        ? productByOffer.get(review.merchantProductId)
        : undefined;
      if (!productId || review._avg.productRating === null) continue;
      const current = ratings.get(productId) ?? { total: 0, count: 0 };
      current.total += review._avg.productRating * review._count._all;
      current.count += review._count._all;
      ratings.set(productId, current);
    }

    const productReviews = await this.prisma.customerReview.groupBy({
      by: ['productId'],
      where: {
        productId: { in: [...productIds] },
        status: ReviewStatus.PUBLISHED,
      },
      _avg: { productRating: true },
      _count: { _all: true },
    });
    for (const review of productReviews) {
      if (!review.productId || review._avg.productRating === null) continue;
      const current = ratings.get(review.productId) ?? { total: 0, count: 0 };
      current.total += review._avg.productRating * review._count._all;
      current.count += review._count._all;
      ratings.set(review.productId, current);
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
      const merchantId = review.merchantProductId
        ? merchantByOffer.get(review.merchantProductId)
        : undefined;
      if (!merchantId || review._avg.merchantRating === null) continue;
      const current = ratings.get(merchantId) ?? { total: 0, count: 0 };
      current.total += review._avg.merchantRating * review._count._all;
      current.count += review._count._all;
      ratings.set(merchantId, current);
    }

    return toRatingMap(ratings);
  }

  async adminList(
    query: AdminReviewQueryDto,
  ): Promise<AdminReviewListResponseDto> {
    const search = query.q?.trim();
    const where: Prisma.CustomerReviewWhereInput = {
      ...(query.reported === 'true'
        ? { reports: { some: { resolvedAt: null } } }
        : {}),
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
              { product: { name: { contains: search, mode: 'insensitive' } } },
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
          reports: {
            where: { resolvedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 5,
            select: { id: true, reason: true, createdAt: true },
          },
          _count: { select: { reports: { where: { resolvedAt: null } } } },
          reviewerHash: true,
          productRating: true,
          merchantRating: true,
          reviewerDisplayName: true,
          title: true,
          comment: true,
          status: true,
          createdAt: true,
          moderatedAt: true,
          product: { select: { id: true, slug: true, name: true } },
          merchantProduct: {
            select: {
              merchant: { select: { id: true, slug: true, name: true } },
              product: { select: { id: true, slug: true, name: true } },
            },
          },
        },
      }),
    ]);
    const hashes = reviews.flatMap((review) =>
      review.reviewerHash ? [review.reviewerHash] : [],
    );
    const bans = await this.prisma.reviewerBan.findMany({
      where: { reviewerHash: { in: hashes } },
      select: { reviewerHash: true, active: true, revision: true },
    });
    const access = new Map(
      bans.map((ban) => [
        ban.reviewerHash,
        { banned: ban.active, revision: ban.revision },
      ]),
    );
    const items: AdminReviewItemDto[] = reviews.map((review) => ({
      id: review.id,
      reviewerAccess: review.reviewerHash
        ? (access.get(review.reviewerHash) ?? { banned: false, revision: null })
        : null,
      reports: review.reports.map((report) => ({
        ...report,
        createdAt: report.createdAt.toISOString(),
      })),
      reportCount: review._count.reports,
      productRating: review.productRating,
      merchantRating: review.merchantRating,
      combinedRating: combineRatings(
        review.productRating,
        review.merchantRating,
      ),
      reviewerDisplayName: review.reviewerDisplayName,
      title: review.title,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      merchant: review.merchantProduct?.merchant ?? null,
      product: this.reviewProduct(review),
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async resolveReports(
    reviewId: string,
    reportIds: string[],
    actorId: string,
  ): Promise<{ saved: boolean }> {
    // Resolve only the reports the operator actually saw. Concurrent new reports
    // remain open; clients cannot resolve another review's reports via copied IDs.
    await this.prisma.reviewReport.updateMany({
      where: { id: { in: reportIds }, reviewId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedBy: actorId },
    });
    return { saved: true };
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
        _count: { _all: true, merchantRating: true },
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
        count: published._count.merchantRating,
      },
    };
  }

  async moderate(
    id: string,
    input: UpdateReviewStatusDto,
    actorId = 'local-admin',
  ): Promise<AdminReviewItemDto> {
    const review = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.customerReview.findUnique({
          where: { id },
          select: { id: true, reviewerHash: true, comment: true, title: true },
        });
        if (!existing) {
          throw new NotFoundException('Review not found.');
        }

        if (existing.reviewerHash) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review:${existing.reviewerHash}`}, 0))`;
          if (input.status === ReviewStatus.PUBLISHED)
            await assertReviewerCanPost(tx, existing.reviewerHash, true);
        }
        if (input.status === ReviewStatus.PUBLISHED) {
          assertAcceptableComment(existing.comment);
          assertAcceptableComment(existing.title);
        }
        const pending = input.status === ReviewStatus.PENDING;
        return tx.customerReview.update({
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
            product: { select: { id: true, slug: true, name: true } },
            merchantProduct: {
              select: {
                merchant: { select: { id: true, slug: true, name: true } },
                product: { select: { id: true, slug: true, name: true } },
              },
            },
          },
        });
      },
      { maxWait: 5_000, timeout: 10_000 },
    );

    return {
      id: review.id,
      productRating: review.productRating,
      merchantRating: review.merchantRating,
      combinedRating: combineRatings(
        review.productRating,
        review.merchantRating,
      ),
      reviewerDisplayName: review.reviewerDisplayName,
      title: review.title,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      merchant: review.merchantProduct?.merchant ?? null,
      product: this.reviewProduct(review),
    };
  }

  private reviewProduct(review: {
    product: { id: string; slug: string; name: string } | null;
    merchantProduct: {
      product: { id: string; slug: string; name: string };
    } | null;
  }): { id: string; slug: string; name: string } {
    const product = review.product ?? review.merchantProduct?.product;
    if (!product)
      throw new InternalServerErrorException('Review product unavailable.');
    return product;
  }
}
