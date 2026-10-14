import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { FreshnessService } from '../src/common/freshness/freshness.service';
import { ReviewsService } from '../src/reviews/reviews.service';
import { MerchantsService } from '../src/merchants/merchants.service';
import { AdminProductsService } from '../src/admin-products/admin-products.service';
import {
  AdminProductQueryDto,
  AdminProductSort,
} from '../src/admin-products/admin-products.dto';
import { AdminMerchantQueryDto } from '../src/merchants/merchants.dto';
import { Prisma } from '../src/generated/prisma/client';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a disposable localhost test database is allowed.');
const run = url ? describe : describe.skip;
const prefix = `admintools-${randomUUID().slice(0, 8)}`;
const owner = 'firebase:owner-uid';

run('admin product list and owner-only merchant soft delete', () => {
  let prisma: PrismaService;
  let merchants: MerchantsService;
  let products: AdminProductsService;
  let categoryId: string, brandId: string;
  let cheapId: string, dearId: string, unpricedId: string;
  let shopA: string, shopB: string;
  const config = new ConfigService({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    MERCHANT_DELETE_ACTOR_IDS: [owner],
  });
  const query = (input: Partial<AdminProductQueryDto>): AdminProductQueryDto =>
    Object.assign(new AdminProductQueryDto(), input);

  beforeAll(async () => {
    prisma = new PrismaService(config);
    await prisma.$connect();
    merchants = new MerchantsService(
      prisma,
      new FreshnessService(config),
      new ReviewsService(prisma),
      config,
    );
    products = new AdminProductsService(prisma);
    categoryId = (
      await prisma.category.create({ data: { name: prefix, slug: prefix } })
    ).id;
    brandId = (
      await prisma.brand.create({
        data: { name: `${prefix} Brand`, slug: prefix },
      })
    ).id;
    const product = async (name: string, minutesAgo: number): Promise<string> =>
      (
        await prisma.product.create({
          data: {
            name: `${prefix} ${name}`,
            slug: `${prefix}-${name}`,
            categoryId,
            brandId,
            createdAt: new Date(Date.now() - minutesAgo * 60_000),
          },
        })
      ).id;
    cheapId = await product('cheap', 30);
    dearId = await product('dear', 20);
    unpricedId = await product('unpriced', 10);
    shopA = (
      await prisma.merchant.create({
        data: { name: `${prefix} A`, slug: `${prefix}-a` },
      })
    ).id;
    shopB = (
      await prisma.merchant.create({
        data: { name: `${prefix} B`, slug: `${prefix}-b` },
      })
    ).id;
    const offer = (
      merchantId: string,
      productId: string,
      price: string | null,
    ): Promise<unknown> =>
      prisma.merchantProduct.create({
        data: {
          merchantId,
          productId,
          merchantSku: `${prefix}-${randomUUID().slice(0, 6)}`,
          price: price === null ? null : new Prisma.Decimal(price),
          currency: 'BRL',
          availability: 'IN_STOCK',
          sourceUpdatedAt: new Date(),
        },
      });
    await offer(shopA, cheapId, '10.00');
    await offer(shopB, cheapId, '5.00');
    await offer(shopA, dearId, '99.00');
    await offer(shopB, unpricedId, null);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.merchantProduct.deleteMany({
      where: { merchantId: { in: [shopA, shopB] } },
    });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.merchant.deleteMany({ where: { id: { in: [shopA, shopB] } } });
    await prisma.brand.delete({ where: { id: brandId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it('sorts by price with unpriced products last, and by date both ways', async () => {
    const names = async (sort: AdminProductSort): Promise<string[]> =>
      (await products.list(query({ categoryId, sort }))).items.map((item) =>
        item.name.replace(`${prefix} `, ''),
      );
    expect(await names(AdminProductSort.PRICE_ASC)).toEqual([
      'cheap',
      'dear',
      'unpriced',
    ]);
    expect(await names(AdminProductSort.PRICE_DESC)).toEqual([
      'dear',
      'cheap',
      'unpriced',
    ]);
    expect(await names(AdminProductSort.NEWEST)).toEqual([
      'unpriced',
      'dear',
      'cheap',
    ]);
    expect(await names(AdminProductSort.OLDEST)).toEqual([
      'cheap',
      'dear',
      'unpriced',
    ]);
  });

  it('filters by merchant, uses that merchant price, and searches by name', async () => {
    const forA = await products.list(query({ categoryId, merchantId: shopA }));
    expect(forA.total).toBe(2);
    const cheap = forA.items.find((item) => item.id === cheapId);
    expect(cheap?.lowestPrice).toEqual({ amount: '10', currency: 'BRL' });
    const all = await products.list(query({ categoryId }));
    expect(
      all.items.find((item) => item.id === cheapId)?.lowestPrice?.amount,
    ).toBe('5');
    const search = await products.list(query({ q: `${prefix} dea` }));
    expect(search.items.map((item) => item.id)).toEqual([dearId]);
    const wildcard = await products.list(query({ categoryId, q: '%' }));
    expect(wildcard.total).toBe(0);
  });

  it('lets only the owner soft delete, and hides the merchant everywhere', async () => {
    await expect(
      merchants.softDelete(shopB, 'firebase:someone-else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const before = await merchants.adminList(
      Object.assign(new AdminMerchantQueryDto(), { q: prefix }),
      'firebase:someone-else',
    );
    expect(before.canDelete).toBe(false);
    expect(before.total).toBe(2);

    await merchants.softDelete(shopB, owner);
    const row = await prisma.merchant.findUniqueOrThrow({
      where: { id: shopB },
    });
    expect(row.active).toBe(false);
    expect(row.deletedBy).toBe(owner);
    expect(row.deletedAt).not.toBeNull();
    // Offers and history are kept.
    expect(
      await prisma.merchantProduct.count({ where: { merchantId: shopB } }),
    ).toBe(2);

    const after = await merchants.adminList(
      Object.assign(new AdminMerchantQueryDto(), { q: prefix }),
      owner,
    );
    expect(after.canDelete).toBe(true);
    expect(after.items.map((item) => item.id)).toEqual([shopA]);
    // The deleted store's price no longer counts as the lowest price.
    const list = await products.list(query({ categoryId }));
    expect(
      list.items.find((item) => item.id === cheapId)?.lowestPrice?.amount,
    ).toBe('10');
    await expect(merchants.softDelete(shopB, owner)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
