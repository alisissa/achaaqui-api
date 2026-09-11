import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { lockMerchantOffers } from '../common/offer-lock';
import { PrismaService } from '../database/prisma.service';
import {
  Prisma,
  type MerchantProduct,
  type OfferAvailability,
} from '../generated/prisma/client';
import {
  normalizeIdentifier,
  normalizeImportRecord,
} from '../imports/import-normalization';
import {
  AdminOfferDto,
  AdminOfferListDto,
  CatalogProductChoiceListDto,
  CreateMerchantOfferDto,
  NewCatalogProductDto,
  OfferQueryDto,
  OfferValuesDto,
  RemoveMerchantOfferDto,
  UpdateMerchantOfferDto,
} from './merchant-offers.dto';

const offerSelect = {
  id: true,
  merchantSku: true,
  price: true,
  currency: true,
  availability: true,
  stockQuantity: true,
  active: true,
  updatedAt: true,
  sourceUpdatedAt: true,
  product: { select: { id: true, name: true, slug: true, barcode: true } },
} satisfies Prisma.MerchantProductSelect;
type OfferRecord = Prisma.MerchantProductGetPayload<{
  select: typeof offerSelect;
}>;

@Injectable()
export class MerchantOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(
    merchantId: string,
    query: OfferQueryDto,
  ): Promise<AdminOfferListDto> {
    await this.requireMerchant(this.prisma, merchantId, false);
    const where: Prisma.MerchantProductWhereInput = {
      merchantId,
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.q
        ? {
            OR: [
              { merchantSku: { contains: query.q, mode: 'insensitive' } },
              { product: { name: { contains: query.q, mode: 'insensitive' } } },
              {
                product: {
                  barcode: { contains: query.q, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [total, offers] = await Promise.all([
      this.prisma.merchantProduct.count({ where }),
      this.prisma.merchantProduct.findMany({
        where,
        select: offerSelect,
        orderBy: { merchantSku: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: offers.map((offer) => this.toDto(offer)),
      ...paginationMeta(total, query.page, query.pageSize),
    };
  }

  async products(query: OfferQueryDto): Promise<CatalogProductChoiceListDto> {
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { barcode: { contains: query.q, mode: 'insensitive' } },
              { model: { contains: query.q, mode: 'insensitive' } },
              { brand: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          barcode: true,
          brand: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }

  async detail(merchantId: string, offerId: string): Promise<AdminOfferDto> {
    const offer = await this.prisma.merchantProduct.findFirst({
      where: { id: offerId, merchantId },
      select: offerSelect,
    });
    if (!offer) throw new NotFoundException('Merchant offer not found.');
    return this.toDto(offer);
  }

  async create(
    merchantId: string,
    input: CreateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    if (Boolean(input.productId) === Boolean(input.newProduct))
      throw new BadRequestException(
        'Choose an existing product or enter one new product.',
      );
    const values = this.validateValues(input);
    try {
      const offer = await this.prisma.$transaction(async (tx) => {
        await this.requireMerchant(tx, merchantId);
        const product = input.newProduct
          ? await this.createProduct(tx, input.newProduct)
          : await tx.product.findFirst({
              where: { id: input.productId, status: 'ACTIVE' },
              select: { id: true },
            });
        if (!product)
          throw new NotFoundException('Active catalog product not found.');
        await lockMerchantOffers(tx, merchantId, [product.id]);
        const existing = await tx.merchantProduct.findFirst({
          where: {
            merchantId,
            OR: [
              { productId: product.id },
              { merchantSku: values.merchantSku },
            ],
          },
          select: { id: true },
        });
        if (existing)
          throw new ConflictException(
            'This product or SKU already belongs to the merchant. Edit or restore its existing offer.',
          );
        const created = await tx.merchantProduct.create({
          data: {
            ...values,
            merchantId,
            productId: product.id,
            sourceUpdatedAt: new Date(),
          },
          select: offerSelect,
        });
        await tx.priceHistory.create({
          data: {
            merchantProductId: created.id,
            newPrice: created.price,
            currency: created.currency,
            source: 'MANUAL',
            actorId: 'admin-api-key',
          },
        });
        return created;
      });
      return this.toDto(offer);
    } catch (error: unknown) {
      this.rethrowConflict(error);
    }
  }

  async update(
    merchantId: string,
    offerId: string,
    input: UpdateMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    const values = this.validateValues(input);
    try {
      const offer = await this.prisma.$transaction(async (tx) => {
        await this.requireMerchant(tx, merchantId);
        const current = await this.lockCurrent(tx, merchantId, offerId);
        this.assertVersion(current, input.expectedUpdatedAt);
        const activeProduct = await tx.product.findFirst({
          where: { id: current.productId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeProduct)
          throw new ConflictException('The catalog product is inactive.');
        const priceChanged =
          !current.price.equals(values.price) ||
          current.currency !== values.currency;
        if (priceChanged && !input.confirmWarnings) {
          const movement = values.price
            .minus(current.price)
            .abs()
            .div(current.price)
            .times(100);
          if (
            current.currency !== values.currency ||
            movement.greaterThanOrEqualTo(
              this.config.get<number>('IMPORT_SUSPICIOUS_CHANGE_PERCENT', 50),
            )
          ) {
            throw new ConflictException(
              'Large price or currency change. Review the values and check the warning acknowledgement before saving.',
            );
          }
        }
        const now = new Date(
          Math.max(Date.now(), current.updatedAt.getTime() + 1),
        );
        const updated = await tx.merchantProduct.update({
          where: { id: current.id, merchantId },
          data: {
            ...values,
            active: input.active,
            sourceUpdatedAt: now,
            updatedAt: now,
          },
          select: offerSelect,
        });
        if (priceChanged)
          await tx.priceHistory.create({
            data: {
              merchantProductId: offerId,
              oldPrice: current.price,
              oldCurrency: current.currency,
              newPrice: values.price,
              currency: values.currency,
              source: 'MANUAL',
              actorId: 'admin-api-key',
              changedAt: now,
            },
          });
        return updated;
      });
      return this.toDto(offer);
    } catch (error: unknown) {
      this.rethrowConflict(error);
    }
  }

  async remove(
    merchantId: string,
    offerId: string,
    input: RemoveMerchantOfferDto,
  ): Promise<AdminOfferDto> {
    if (input.confirmed !== true)
      throw new BadRequestException('Confirm removal of this merchant offer.');
    const offer = await this.prisma.$transaction(async (tx) => {
      await this.requireMerchant(tx, merchantId, false);
      const current = await this.lockCurrent(tx, merchantId, offerId);
      if (current.active) this.assertVersion(current, input.expectedUpdatedAt);
      return await tx.merchantProduct.update({
        where: { id: current.id, merchantId },
        data: current.active
          ? {
              active: false,
              updatedAt: new Date(
                Math.max(Date.now(), current.updatedAt.getTime() + 1),
              ),
            }
          : {},
        select: offerSelect,
      });
    });
    return this.toDto(offer);
  }

  private validateValues(input: OfferValuesDto): {
    merchantSku: string;
    price: Prisma.Decimal;
    currency: string;
    stockQuantity: number | null;
    availability: OfferAvailability;
  } {
    if (input.confirmed !== true)
      throw new BadRequestException('Confirm the offer change before saving.');
    const normalized = normalizeImportRecord(
      { ...input, productName: 'Manual offer', stock: input.stock ?? '' },
      new Set(
        this.config
          .get<string>('IMPORT_SUPPORTED_CURRENCIES', 'BRL,USD,PYG')
          .split(','),
      ),
    );
    const { data, errors, warnings } = normalized;
    if (errors.length || !data.price || !data.currency || !data.merchantSku)
      throw new BadRequestException(errors);
    if (warnings.length && !input.confirmWarnings)
      throw new ConflictException(
        `${warnings.join(' ')} Check the warning acknowledgement to save.`,
      );
    return {
      merchantSku: data.merchantSku,
      price: new Prisma.Decimal(data.price),
      currency: data.currency,
      stockQuantity: data.stock,
      availability: data.availability,
    };
  }

  private async createProduct(
    tx: Prisma.TransactionClient,
    input: NewCatalogProductDto,
  ): Promise<{ id: string }> {
    if (!input.name.trim() || !input.brand.trim())
      throw new BadRequestException('Product name and brand are required.');
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, active: true },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Active category not found.');
    const barcode = normalizeIdentifier(input.barcode);
    if (
      barcode &&
      (await tx.product.findFirst({
        where: { barcode: { equals: barcode, mode: 'insensitive' } },
        select: { id: true },
      }))
    )
      throw new ConflictException(
        'That barcode already exists. Select the existing catalog product.',
      );
    const brandName = input.brand.normalize('NFKC').trim();
    const brandSlug =
      brandName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 110) || `brand-${randomUUID().slice(0, 8)}`;
    const brand = await tx.brand.upsert({
      where: { slug: brandSlug },
      update: {},
      create: { slug: brandSlug, name: brandName },
      select: { id: true, active: true },
    });
    if (!brand.active) throw new ConflictException('This brand is inactive.');
    const name = input.name.normalize('NFKC').trim();
    const productLock = `catalog:${brand.id}:${name.toLowerCase()}:${input.model?.trim() || ''}`;
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${productLock}, 0))`,
    );
    const duplicate = await tx.product.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        brandId: brand.id,
        model: input.model?.trim() || null,
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        'This product name, brand, and model already exist. Select the existing catalog product.',
      );
    const slug = `${
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 130) || 'product'
    }-${randomUUID().slice(0, 8)}`;
    return await tx.product.create({
      data: {
        name,
        slug,
        brandId: brand.id,
        categoryId: category.id,
        barcode,
        model: input.model?.trim() || null,
      },
      select: { id: true },
    });
  }

  private async requireMerchant(
    tx: Prisma.TransactionClient,
    id: string,
    active = true,
  ): Promise<void> {
    const merchant = await tx.merchant.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!merchant || (active && !merchant.active))
      throw new NotFoundException('Merchant not found or inactive.');
  }

  private async lockCurrent(
    tx: Prisma.TransactionClient,
    merchantId: string,
    offerId: string,
  ): Promise<MerchantProduct> {
    const offer = await tx.merchantProduct.findFirst({
      where: { id: offerId, merchantId },
      select: { productId: true },
    });
    if (!offer) throw new NotFoundException('Merchant offer not found.');
    await lockMerchantOffers(tx, merchantId, [offer.productId]);
    const current = await tx.merchantProduct.findFirst({
      where: { id: offerId, merchantId },
    });
    if (!current) throw new NotFoundException('Merchant offer not found.');
    return current;
  }

  private assertVersion(current: MerchantProduct, expected: string): void {
    if (current.updatedAt.toISOString() !== expected)
      throw new ConflictException(
        'This offer changed since you opened it. Reload and review the latest values before saving.',
      );
  }

  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException(
        'The SKU, barcode, or product already exists. Reload and choose its existing record.',
      );
    throw error;
  }

  private toDto(offer: OfferRecord): AdminOfferDto {
    return {
      id: offer.id,
      merchantSku: offer.merchantSku,
      price: { amount: offer.price.toFixed(2), currency: offer.currency },
      availability: offer.availability,
      stockQuantity: offer.stockQuantity,
      active: offer.active,
      updatedAt: offer.updatedAt.toISOString(),
      sourceUpdatedAt: offer.sourceUpdatedAt.toISOString(),
      product: offer.product,
    };
  }
}
