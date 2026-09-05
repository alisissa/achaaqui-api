import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FreshnessService } from '../common/freshness/freshness.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma, ProductStatus } from '../generated/prisma/client';
import { combineRatings, ReviewsService } from '../reviews/reviews.service';
import {
  AdminMerchantItemDto,
  AdminMerchantListResponseDto,
  AdminMerchantQueryDto,
  CreateMerchantDto,
  MerchantDetailDto,
  MerchantListResponseDto,
  MerchantOfferItemDto,
  MerchantOfferListResponseDto,
  MerchantOffersQueryDto,
  MerchantSummaryDto,
} from './merchants.dto';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly freshnessService: FreshnessService,
    private readonly reviewsService: ReviewsService,
  ) {}

  async list(query: PaginationQueryDto): Promise<MerchantListResponseDto> {
    const where = { active: true };
    const skip = (query.page - 1) * query.pageSize;
    const [total, merchants] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          city: true,
          countryCode: true,
          _count: {
            select: {
              offers: {
                where: {
                  active: true,
                  product: { status: ProductStatus.ACTIVE },
                },
              },
            },
          },
        },
      }),
    ]);
    const ratings = await this.reviewsService.merchantRatings(
      merchants.map((merchant) => merchant.id),
    );
    const items: MerchantSummaryDto[] = merchants.map((merchant) => ({
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      logoUrl: merchant.logoUrl,
      city: merchant.city,
      countryCode: merchant.countryCode,
      offerCount: merchant._count.offers,
      rating: ratings.get(merchant.id) ?? { average: null, count: 0 },
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async detail(slug: string): Promise<MerchantDetailDto> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        city: true,
        countryCode: true,
        address: true,
        phone: true,
        email: true,
        websiteUrl: true,
        active: true,
        _count: {
          select: {
            offers: {
              where: {
                active: true,
                product: { status: ProductStatus.ACTIVE },
              },
            },
          },
        },
      },
    });

    if (!merchant || !merchant.active) {
      throw new NotFoundException('Merchant not found.');
    }

    const ratings = await this.reviewsService.merchantRatings([merchant.id]);

    return {
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      logoUrl: merchant.logoUrl,
      city: merchant.city,
      countryCode: merchant.countryCode,
      address: merchant.address,
      phone: merchant.phone,
      email: merchant.email,
      websiteUrl: merchant.websiteUrl,
      offerCount: merchant._count.offers,
      rating: ratings.get(merchant.id) ?? { average: null, count: 0 },
    };
  }

  async offers(
    slug: string,
    query: MerchantOffersQueryDto,
  ): Promise<MerchantOfferListResponseDto> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { slug },
      select: { id: true, active: true },
    });
    if (!merchant || !merchant.active) {
      throw new NotFoundException('Merchant not found.');
    }

    const search = query.q?.trim();
    const where: Prisma.MerchantProductWhereInput = {
      merchantId: merchant.id,
      active: true,
      product: {
        status: ProductStatus.ACTIVE,
        ...(query.categorySlug
          ? { category: { slug: query.categorySlug, active: true } }
          : {}),
      },
      ...(search
        ? {
            OR: [
              { merchantSku: { contains: search, mode: 'insensitive' } },
              {
                product: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { model: { contains: search, mode: 'insensitive' } },
                    {
                      brand: {
                        name: { contains: search, mode: 'insensitive' },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, offers] = await Promise.all([
      this.prisma.merchantProduct.count({ where }),
      this.prisma.merchantProduct.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: [
          { currency: 'asc' },
          { availability: 'asc' },
          { price: 'asc' },
        ],
        select: {
          id: true,
          merchantSku: true,
          price: true,
          currency: true,
          availability: true,
          stockQuantity: true,
          sourceUpdatedAt: true,
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              model: true,
              brand: { select: { id: true, slug: true, name: true } },
              category: { select: { id: true, slug: true, name: true } },
              images: {
                take: 1,
                orderBy: { sortOrder: 'asc' },
                select: { url: true },
              },
            },
          },
        },
      }),
    ]);
    const [productRatings, merchantRatings] = await Promise.all([
      this.reviewsService.productRatings(
        offers.map((offer) => offer.product.id),
      ),
      this.reviewsService.merchantRatings([merchant.id]),
    ]);
    const merchantRating = merchantRatings.get(merchant.id) ?? {
      average: null,
      count: 0,
    };
    const items: MerchantOfferItemDto[] = offers.map((offer) => {
      const productRating = productRatings.get(offer.product.id) ?? {
        average: null,
        count: 0,
      };

      return {
        id: offer.id,
        merchantSku: offer.merchantSku,
        price: { amount: offer.price.toString(), currency: offer.currency },
        availability: offer.availability,
        stockQuantity: offer.stockQuantity,
        freshness: this.freshnessService.forOffer(
          offer.availability,
          offer.sourceUpdatedAt,
        ),
        productRating,
        merchantRating,
        combinedRating: combineRatings(
          productRating.average,
          merchantRating.average,
        ),
        product: {
          id: offer.product.id,
          slug: offer.product.slug,
          name: offer.product.name,
          model: offer.product.model,
          brand: offer.product.brand,
          category: offer.product.category,
          primaryImage: offer.product.images[0]?.url ?? null,
        },
      };
    });

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async adminList(
    query: AdminMerchantQueryDto,
  ): Promise<AdminMerchantListResponseDto> {
    const search = query.q?.trim();
    const where: Prisma.MerchantWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, merchants] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          address: true,
          city: true,
          countryCode: true,
          phone: true,
          email: true,
          websiteUrl: true,
          active: true,
          createdAt: true,
          _count: { select: { offers: true } },
        },
      }),
    ]);
    const ratings = await this.reviewsService.merchantRatings(
      merchants.map((merchant) => merchant.id),
    );
    const items: AdminMerchantItemDto[] = merchants.map((merchant) => ({
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      logoUrl: merchant.logoUrl,
      address: merchant.address,
      city: merchant.city,
      countryCode: merchant.countryCode,
      phone: merchant.phone,
      email: merchant.email,
      websiteUrl: merchant.websiteUrl,
      active: merchant.active,
      offerCount: merchant._count.offers,
      rating: ratings.get(merchant.id) ?? { average: null, count: 0 },
      createdAt: merchant.createdAt.toISOString(),
    }));

    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async create(input: CreateMerchantDto): Promise<AdminMerchantItemDto> {
    const name = input.name.trim();
    const slug = input.slug ?? this.slugify(name);
    if (!slug) {
      throw new BadRequestException(
        'Merchant name must contain letters or numbers.',
      );
    }
    const existing = await this.prisma.merchant.findFirst({
      where: {
        OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Merchant name or slug already exists.');
    }

    const merchant = await this.prisma.merchant.create({
      data: {
        name,
        slug,
        logoUrl: input.logoUrl,
        address: input.address?.trim(),
        city: input.city?.trim(),
        countryCode: input.countryCode,
        phone: input.phone?.trim(),
        email: input.email?.trim().toLowerCase(),
        websiteUrl: input.websiteUrl,
        active: input.active ?? true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        address: true,
        city: true,
        countryCode: true,
        phone: true,
        email: true,
        websiteUrl: true,
        active: true,
        createdAt: true,
      },
    });

    return {
      ...merchant,
      offerCount: 0,
      rating: { average: null, count: 0 },
      createdAt: merchant.createdAt.toISOString(),
    };
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 140);
  }
}
