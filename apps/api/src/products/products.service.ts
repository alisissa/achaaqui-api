import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type SearchClientContext,
  SearchAnalyticsService,
} from '../analytics/search-analytics.service';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { FreshnessService } from '../common/freshness/freshness.service';
import { PrismaService } from '../database/prisma.service';
import {
  type OfferAvailability,
  Prisma,
  ProductStatus,
} from '../generated/prisma/client';
import {
  OfferDto,
  PriceHistoryItemDto,
  PriceHistoryQueryDto,
  PriceHistoryResponseDto,
  ProductDetailDto,
  ProductListQueryDto,
  ProductListResponseDto,
  ProductSort,
  ProductSummaryDto,
} from './products.dto';
import { normalizeIdentifier } from '../imports/import-normalization';
import { combineRatings, ReviewsService } from '../reviews/reviews.service';
import type { RatingSummaryDto } from '../reviews/reviews.dto';

const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  model: true,
  createdAt: true,
  brand: { select: { id: true, slug: true, name: true } },
  category: { select: { id: true, slug: true, name: true } },
  images: {
    take: 1,
    orderBy: { sortOrder: 'asc' },
    select: { url: true },
  },
  offers: {
    where: { active: true, merchant: { active: true } },
    select: {
      price: true,
      currency: true,
      availability: true,
      sourceUpdatedAt: true,
      merchantId: true,
    },
  },
} satisfies Prisma.ProductSelect;

const PRODUCT_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  model: true,
  barcode: true,
  status: true,
  brand: { select: { id: true, slug: true, name: true } },
  category: { select: { id: true, slug: true, name: true } },
  images: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, url: true, altText: true, sortOrder: true },
  },
  offers: {
    where: { active: true, merchant: { active: true } },
    select: {
      id: true,
      merchantSku: true,
      price: true,
      currency: true,
      availability: true,
      stockQuantity: true,
      sourceUpdatedAt: true,
      merchant: {
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          city: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductCardRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_CARD_SELECT;
}>;
type ProductDetailRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_DETAIL_SELECT;
}>;

function availabilityRank(availability: OfferAvailability): number {
  switch (availability) {
    case 'IN_STOCK':
      return 0;
    case 'UNKNOWN':
      return 1;
    case 'OUT_OF_STOCK':
      return 2;
  }
}

export function orderedOffers<
  T extends {
    availability: OfferAvailability;
    currency: string;
    price: Prisma.Decimal;
  },
>(offers: readonly T[]): T[] {
  return [...offers].sort((first, second) => {
    const availabilityDifference =
      availabilityRank(first.availability) -
      availabilityRank(second.availability);
    if (availabilityDifference !== 0) return availabilityDifference;
    const currencyDifference = first.currency.localeCompare(second.currency);
    return currencyDifference !== 0
      ? currencyDifference
      : first.price.comparedTo(second.price);
  });
}

export function lowestPricesByCurrency<
  T extends {
    availability: OfferAvailability;
    currency: string;
    price: Prisma.Decimal;
  },
>(offers: readonly T[]): Array<{ amount: string; currency: string }> {
  const lowest = new Map<string, T>();
  for (const offer of orderedOffers(offers)) {
    if (!lowest.has(offer.currency)) lowest.set(offer.currency, offer);
  }
  return [...lowest.values()].map((offer) => ({
    amount: offer.price.toString(),
    currency: offer.currency,
  }));
}

export function singleCurrencyBestPrice(
  prices: readonly { amount: string; currency: string }[],
): { amount: string; currency: string } | null {
  return prices.length === 1 ? (prices[0] ?? null) : null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly freshnessService: FreshnessService,
    private readonly reviewsService: ReviewsService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
  ) {}

  async list(
    query: ProductListQueryDto,
    searchContext: SearchClientContext,
  ): Promise<ProductListResponseDto> {
    const where = this.productWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: this.productOrder(query.sort),
        select: PRODUCT_CARD_SELECT,
      }),
    ]);

    const ratings = await this.reviewsService.productRatings(
      products.map((product) => product.id),
    );
    if (query.q?.trim()) {
      await this.searchAnalyticsService.recordProductSearch({
        query: query.q,
        page: query.page,
        pageSize: query.pageSize,
        resultCount: total,
        hits: products.map((product) => ({
          productId: product.id,
          merchantIds: product.offers.map((offer) => offer.merchantId),
        })),
        context: searchContext,
      });
    }

    return {
      items: products.map((product) =>
        this.toSummary(
          product,
          ratings.get(product.id) ?? { average: null, count: 0 },
        ),
      ),
      ...paginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(slug: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: PRODUCT_DETAIL_SELECT,
    });

    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found.');
    }

    const merchantIds = product.offers.map((offer) => offer.merchant.id);
    const [productRatings, merchantRatings] = await Promise.all([
      this.reviewsService.productRatings([product.id]),
      this.reviewsService.merchantRatings(merchantIds),
    ]);

    return this.toDetail(
      product,
      productRatings.get(product.id) ?? { average: null, count: 0 },
      merchantRatings,
    );
  }

  async priceHistory(
    slug: string,
    query: PriceHistoryQueryDto,
  ): Promise<PriceHistoryResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found.');
    }

    const changedAfter = new Date(
      Date.now() - query.days * 24 * 60 * 60 * 1000,
    );
    const where: Prisma.PriceHistoryWhereInput = {
      changedAt: { gte: changedAfter },
      merchantProduct: {
        productId: product.id,
        ...(query.merchantSlug
          ? { merchant: { slug: query.merchantSlug, active: true } }
          : {}),
      },
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, history] = await Promise.all([
      this.prisma.priceHistory.count({ where }),
      this.prisma.priceHistory.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { changedAt: 'desc' },
        select: {
          id: true,
          oldPrice: true,
          oldCurrency: true,
          newPrice: true,
          currency: true,
          source: true,
          changedAt: true,
          merchantProduct: {
            select: {
              merchant: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  logoUrl: true,
                  city: true,
                },
              },
            },
          },
        },
      }),
    ]);
    const items: PriceHistoryItemDto[] = history.map((entry) => ({
      id: entry.id,
      merchant: entry.merchantProduct.merchant,
      oldPrice: entry.oldPrice
        ? {
            amount: entry.oldPrice.toString(),
            currency: entry.oldCurrency ?? entry.currency,
          }
        : null,
      newPrice: { amount: entry.newPrice.toString(), currency: entry.currency },
      source: entry.source,
      changedAt: entry.changedAt.toISOString(),
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  private productWhere(query: ProductListQueryDto): Prisma.ProductWhereInput {
    const search = query.q?.trim();
    const normalizedIdentifier = normalizeIdentifier(search);

    return {
      status: ProductStatus.ACTIVE,
      ...(query.categorySlug
        ? { category: { slug: query.categorySlug, active: true } }
        : {}),
      ...(query.merchantSlug
        ? {
            offers: {
              some: {
                active: true,
                merchant: { slug: query.merchantSlug, active: true },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { model: { contains: search, mode: 'insensitive' } },
              ...(normalizedIdentifier
                ? [{ barcode: { equals: normalizedIdentifier } }]
                : []),
              { brand: { name: { contains: search, mode: 'insensitive' } } },
              {
                offers: {
                  some: {
                    merchantSku: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private productOrder(
    sort: ProductSort,
  ): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case ProductSort.RECENT:
        return [{ createdAt: 'desc' }, { name: 'asc' }];
      case ProductSort.POPULAR:
        return [{ popularityScore: 'desc' }, { name: 'asc' }];
      case ProductSort.FEATURED:
        return [
          { featured: 'desc' },
          { popularityScore: 'desc' },
          { name: 'asc' },
        ];
    }
  }

  private toSummary(
    product: ProductCardRecord,
    rating: RatingSummaryDto,
  ): ProductSummaryDto {
    const offers = orderedOffers(product.offers);
    const bestPrices = lowestPricesByCurrency(offers);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      model: product.model,
      brand: product.brand,
      category: product.category,
      primaryImage: product.images[0]?.url ?? null,
      bestPrice: singleCurrencyBestPrice(bestPrices),
      bestPrices,
      merchantCount: new Set(offers.map((offer) => offer.merchantId)).size,
      available: offers.some((offer) => offer.availability === 'IN_STOCK'),
      freshness: this.freshnessService.forProduct(offers),
      createdAt: product.createdAt.toISOString(),
      rating,
    };
  }

  private toDetail(
    product: ProductDetailRecord,
    productRating: RatingSummaryDto,
    merchantRatings: ReadonlyMap<string, RatingSummaryDto>,
  ): ProductDetailDto {
    const offers = orderedOffers(product.offers);
    const bestPrices = lowestPricesByCurrency(offers);
    const responseOffers: OfferDto[] = offers.map((offer) => {
      const merchantRating = merchantRatings.get(offer.merchant.id) ?? {
        average: null,
        count: 0,
      };

      return {
        id: offer.id,
        merchantSku: offer.merchantSku,
        merchant: offer.merchant,
        price: { amount: offer.price.toString(), currency: offer.currency },
        availability: offer.availability,
        stockQuantity: offer.stockQuantity,
        freshness: this.freshnessService.forOffer(
          offer.availability,
          offer.sourceUpdatedAt,
        ),
        merchantRating,
        combinedRating: combineRatings(
          productRating.average,
          merchantRating.average,
        ),
      };
    });
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      model: product.model,
      barcode: product.barcode,
      brand: product.brand,
      category: product.category,
      images: product.images,
      bestPrice: singleCurrencyBestPrice(bestPrices),
      bestPrices,
      favoriteKey: product.slug,
      freshness: this.freshnessService.forProduct(offers),
      rating: productRating,
      offers: responseOffers,
    };
  }
}
