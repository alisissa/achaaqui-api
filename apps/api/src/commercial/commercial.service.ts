import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  lockMerchantAccess,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import { lockMerchantOffers } from '../common/offer-lock';
import { normalizeImportRecord } from '../imports/import-normalization';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommercialChangeDto, HighlightChangeDto } from './commercial.dto';
import {
  COMMERCIAL_SELECT,
  effectivePrice,
  publicCommercial,
} from './offer-pricing';

const publicOfferSelect = {
  id: true,
  price: true,
  currency: true,
  availability: true,
  ...COMMERCIAL_SELECT,
  merchant: {
    select: { id: true, slug: true, name: true, city: true, logoUrl: true },
  },
  product: {
    select: {
      id: true,
      slug: true,
      name: true,
      images: {
        take: 1,
        orderBy: { sortOrder: 'asc' as const },
        select: { url: true },
      },
    },
  },
} satisfies Prisma.MerchantProductSelect;
type PublicOffer = Prisma.MerchantProductGetPayload<{
  select: typeof publicOfferSelect;
}>;
function offerCard(
  offer: PublicOffer,
  now: Date,
): {
  id: string;
  price: { amount: string; currency: string };
  availability: string;
  regularPrice: { amount: string; currency: string } | null;
  saleEndsAt: string | null;
  promotion: { text: string; endsAt: string | null } | null;
  merchant: PublicOffer['merchant'];
  product: {
    id: string;
    slug: string;
    name: string;
    primaryImage: string | null;
  };
} {
  return {
    id: offer.id,
    price: {
      amount: effectivePrice(offer, now).toString(),
      currency: offer.currency,
    },
    availability: offer.availability,
    ...publicCommercial(offer, now),
    merchant: offer.merchant,
    product: {
      id: offer.product.id,
      slug: offer.product.slug,
      name: offer.product.name,
      primaryImage: offer.product.images[0]?.url ?? null,
    },
  };
}
@Injectable()
export class CommercialService {
  constructor(private readonly prisma: PrismaService) {}

  async update(
    merchantId: string,
    offerId: string,
    input: CommercialChangeDto,
    actorId: string,
    actor?: MerchantActor,
  ): Promise<{ updatedAt: string }> {
    if (input.confirmed !== true)
      throw new BadRequestException(
        'Review and confirm these changes before saving.',
      );
    return await this.prisma.$transaction(async (tx) => {
      if (actor) {
        if (actor.merchantId !== merchantId) throw new NotFoundException();
        await lockMerchantAccess(tx, actor);
      }
      const reference = await tx.merchantProduct.findFirst({
        where: { id: offerId, merchantId },
        select: { productId: true },
      });
      if (!reference) throw new NotFoundException('Merchant offer not found.');
      await lockMerchantOffers(tx, merchantId, [reference.productId]);
      const current = await tx.merchantProduct.findFirst({
        where: {
          id: offerId,
          merchantId,
          merchant: { active: true },
          product: { status: 'ACTIVE' },
        },
      });
      if (!current) throw new NotFoundException('Merchant offer not found.');
      if (current.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new ConflictException(
          'This offer changed. Reload before saving.',
        );
      const now = new Date(
        Math.max(Date.now(), current.updatedAt.getTime() + 1),
      );
      let salePrice: Prisma.Decimal | null = null;
      if (input.salePrice !== null) {
        const normalized = normalizeImportRecord(
          {
            merchantSku: current.merchantSku,
            productName: 'Existing product',
            price: input.salePrice,
            currency: current.currency,
          },
          new Set([current.currency]),
        );
        if (normalized.errors.length || !normalized.data.price)
          throw new BadRequestException('Enter a valid sale price.');
        salePrice = new Prisma.Decimal(normalized.data.price);
        if (!salePrice.lessThan(current.price))
          throw new BadRequestException(
            'Sale price must be lower than the regular price.',
          );
      }
      const promotionText = input.promotionText?.trim() || null;
      const saleEndsAt = this.expiry(
        input.saleEndsAt,
        salePrice !== null,
        now,
        salePrice?.equals(current.salePrice ?? -1) ? current.saleEndsAt : null,
      );
      const promotionEndsAt = this.expiry(
        input.promotionEndsAt,
        promotionText !== null,
        now,
        promotionText === current.promotionText
          ? current.promotionEndsAt
          : null,
      );
      const next = {
        ...current,
        salePrice,
        saleEndsAt,
        promotionText,
        promotionEndsAt,
      };
      const oldPrice = effectivePrice(current, now),
        newPrice = effectivePrice(next, now);
      await tx.merchantProduct.update({
        where: { id: offerId },
        data: {
          salePrice,
          saleEndsAt,
          promotionText,
          promotionEndsAt,
          commercialUpdatedBy: actorId,
          updatedAt: now,
          ...(!oldPrice.equals(newPrice) ? { sourceUpdatedAt: now } : {}),
        },
      });
      if (!oldPrice.equals(newPrice))
        await tx.priceHistory.create({
          data: {
            merchantProductId: offerId,
            oldPrice,
            oldCurrency: current.currency,
            newPrice,
            currency: current.currency,
            source: 'MANUAL',
            actorId,
            changedAt: now,
          },
        });
      return { updatedAt: now.toISOString() };
    });
  }

  private expiry(
    value: string | null,
    hasValue: boolean,
    now: Date,
    previous: Date | null,
  ): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (
      !hasValue ||
      !Number.isFinite(date.getTime()) ||
      (date <= now && date.getTime() !== previous?.getTime())
    )
      throw new BadRequestException(
        'End date must be in the future and have a discount or promotion.',
      );
    return date;
  }

  async merchantHighlight(
    id: string,
  ): Promise<{ sponsored: boolean; updatedAt: string }> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: { sponsored: true, updatedAt: true },
    });
    if (!merchant) throw new NotFoundException();
    return {
      sponsored: merchant.sponsored,
      updatedAt: merchant.updatedAt.toISOString(),
    };
  }

  async highlightMerchant(
    id: string,
    input: HighlightChangeDto,
    actorId: string,
  ): Promise<void> {
    const updated = await this.prisma.merchant.updateMany({
      where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
      data: {
        sponsored: input.sponsored,
        highlightedBy: actorId,
        updatedAt: new Date(
          Math.max(Date.now(), Date.parse(input.expectedUpdatedAt) + 1),
        ),
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('This store changed. Reload before saving.');
  }

  async highlightOffer(
    merchantId: string,
    id: string,
    input: HighlightChangeDto,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.merchantProduct.findFirst({
        where: { id, merchantId },
        select: { productId: true },
      });
      if (!offer) throw new NotFoundException();
      await lockMerchantOffers(tx, merchantId, [offer.productId]);
      const updated = await tx.merchantProduct.updateMany({
        where: { id, merchantId, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          sponsored: input.sponsored,
          highlightedBy: actorId,
          updatedAt: new Date(
            Math.max(Date.now(), Date.parse(input.expectedUpdatedAt) + 1),
          ),
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          'This offer changed. Reload before saving.',
        );
    });
  }

  async promotions(query: PaginationQueryDto): Promise<{
    items: ReturnType<typeof offerCard>[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const now = new Date();
    const where: Prisma.MerchantProductWhereInput = {
      active: true,
      merchant: { active: true },
      product: { status: 'ACTIVE' },
      availability: { not: 'OUT_OF_STOCK' },
      OR: [
        {
          salePrice: { not: null },
          OR: [{ saleEndsAt: null }, { saleEndsAt: { gt: now } }],
        },
        {
          promotionText: { not: null },
          OR: [{ promotionEndsAt: null }, { promotionEndsAt: { gt: now } }],
        },
      ],
    };
    const [total, offers] = await Promise.all([
      this.prisma.merchantProduct.count({ where }),
      this.prisma.merchantProduct.findMany({
        where,
        select: publicOfferSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: offers.map((offer) => offerCard(offer, now)),
      ...paginationMeta(total, query.page, query.pageSize),
    };
  }

  async highlights(): Promise<{
    offers: ReturnType<typeof offerCard>[];
    merchants: {
      id: string;
      slug: string;
      name: string;
      city: string | null;
      logoUrl: string | null;
    }[];
  }> {
    const now = new Date();
    const [offers, merchants] = await Promise.all([
      this.prisma.merchantProduct.findMany({
        where: {
          sponsored: true,
          active: true,
          merchant: { active: true },
          product: { status: 'ACTIVE' },
          availability: 'IN_STOCK',
        },
        select: publicOfferSelect,
        orderBy: { id: 'asc' },
        take: 12,
      }),
      this.prisma.merchant.findMany({
        where: { sponsored: true, active: true },
        select: { id: true, slug: true, name: true, city: true, logoUrl: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 12,
      }),
    ]);
    return { offers: offers.map((offer) => offerCard(offer, now)), merchants };
  }
}
