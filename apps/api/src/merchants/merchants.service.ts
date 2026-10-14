import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import {
  PUBLIC_MERCHANT_WHERE,
  REVIEW_MERCHANT_ID,
} from '../common/public-catalog';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FreshnessService } from '../common/freshness/freshness.service';
import { PrismaService } from '../database/prisma.service';
import {
  COMMERCIAL_SELECT,
  publicPrice,
  publicCommercial,
} from '../commercial/offer-pricing';
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
  private readonly logger = new Logger(MerchantsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly freshnessService: FreshnessService,
    private readonly reviewsService: ReviewsService,
    private readonly config: ConfigService,
  ) {}

  canDelete(actorId: string): boolean {
    return (
      this.config.get<string[]>('MERCHANT_DELETE_ACTOR_IDS', []) ?? []
    ).includes(actorId);
  }

  // Soft delete: hide the merchant everywhere, keep every row and its history.
  // Public reads and merchant login already require an active merchant.
  async softDelete(merchantId: string, actorId: string): Promise<void> {
    if (!this.canDelete(actorId))
      throw new ForbiddenException(
        'Only the owner account can delete merchants.',
      );
    const deleted = await this.prisma.$transaction(async (tx) => {
      const result = await tx.merchant.updateMany({
        where: { id: merchantId, deletedAt: null },
        data: {
          active: false,
          sponsored: false,
          highlightedBy: null,
          deletedAt: new Date(),
          deletedBy: actorId,
        },
      });
      if (result.count !== 1) return false;
      // End any open merchant session immediately; the login itself is kept.
      await tx.merchantSession.deleteMany({
        where: { user: { merchantId } },
      });
      return true;
    });
    if (!deleted) throw new NotFoundException('Merchant not found.');
    this.logger.log({ event: 'merchant_soft_deleted', merchantId, actorId });
  }

  async list(query: PaginationQueryDto): Promise<MerchantListResponseDto> {
    const where = PUBLIC_MERCHANT_WHERE;
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

    if (!merchant || !merchant.active || merchant.id === REVIEW_MERCHANT_ID) {
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
    if (!merchant || !merchant.active || merchant.id === REVIEW_MERCHANT_ID) {
      throw new NotFoundException('Merchant not found.');
    }

    const search = query.q?.trim();
    const where: Prisma.MerchantProductWhereInput = {
      merchantId: merchant.id,
      ...(query.includeUnpriced ? {} : { price: { not: null } }),
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
    const now = new Date();
    // Apply effective-price ordering BEFORE pagination, including expired sales.
    const orderedIds = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o.id FROM "MerchantProduct" o JOIN "Product" p ON p.id = o."productId"
      JOIN "Brand" b ON b.id = p."brandId" JOIN "Category" c ON c.id = p."categoryId"
      WHERE o."merchantId" = ${merchant.id}::uuid AND o.active AND p.status = 'ACTIVE'
        ${query.includeUnpriced ? Prisma.empty : Prisma.sql`AND o.price IS NOT NULL`}
        ${query.categorySlug ? Prisma.sql`AND c.slug = ${query.categorySlug} AND c.active` : Prisma.empty}
        ${search ? Prisma.sql`AND (strpos(lower(p.name), lower(${search})) > 0 OR strpos(lower(coalesce(p.model, '')), lower(${search})) > 0 OR strpos(lower(b.name), lower(${search})) > 0)` : Prisma.empty}
      ORDER BY (o.price IS NULL), o.currency, CASE o.availability WHEN 'IN_STOCK' THEN 0 WHEN 'UNKNOWN' THEN 1 ELSE 2 END,
        CASE WHEN o."salePrice" IS NOT NULL AND (o."saleEndsAt" IS NULL OR o."saleEndsAt" > ${now}) THEN o."salePrice" ELSE o.price END,
        o.id LIMIT ${query.pageSize} OFFSET ${skip}`);
    const [total, fetched] = await Promise.all([
      this.prisma.merchantProduct.count({ where }),
      this.prisma.merchantProduct.findMany({
        where: { ...where, id: { in: orderedIds.map((row) => row.id) } },
        select: {
          ...COMMERCIAL_SELECT,
          id: true,
          price: true,
          currency: true,
          availability: true,
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
    const rank = new Map(orderedIds.map((row, index) => [row.id, index]));
    const offers = fetched.sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );
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
        merchantSku: '',
        price: publicPrice(offer, now),
        ...publicCommercial(offer, now),
        availability: offer.availability,
        stockQuantity: null,
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
    actorId = 'local-admin',
  ): Promise<AdminMerchantListResponseDto> {
    const search = query.q?.trim();
    const where: Prisma.MerchantWhereInput = {
      deletedAt: null,
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

    return {
      items,
      ...paginationMeta(total, query.page, query.pageSize),
      canDelete: this.canDelete(actorId),
    };
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
