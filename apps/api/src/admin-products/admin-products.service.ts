import { Injectable } from '@nestjs/common';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AdminProductSort,
  type AdminProductItem,
  type AdminProductList,
  type AdminProductQueryDto,
} from './admin-products.dto';

const likePattern = (value: string): string =>
  `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

// Admin-only catalog list. Unlike the public list it includes inactive
// products, never records search analytics, and sorts by price or date.
@Injectable()
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminProductQueryDto): Promise<AdminProductList> {
    const merchant = query.merchantId
      ? Prisma.sql`AND o."merchantId" = ${query.merchantId}::uuid`
      : Prisma.empty;
    const filters: Prisma.Sql[] = [];
    if (query.status)
      filters.push(Prisma.sql`p.status::text = ${query.status}`);
    if (query.categoryId)
      filters.push(Prisma.sql`p."categoryId" = ${query.categoryId}::uuid`);
    if (query.merchantId)
      filters.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "MerchantProduct" mo WHERE mo."productId" = p.id AND mo."merchantId" = ${query.merchantId}::uuid)`,
      );
    if (query.q) {
      const like = likePattern(query.q);
      filters.push(Prisma.sql`(
        p.name ILIKE ${like} OR b.name ILIKE ${like} OR p.model ILIKE ${like}
        OR p.barcode = ${query.q}
        OR EXISTS (SELECT 1 FROM "MerchantProduct" so WHERE so."productId" = p.id AND so."merchantSku" ILIKE ${like})
      )`);
    }
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;
    const order = {
      [AdminProductSort.NEWEST]: Prisma.sql`p."createdAt" DESC`,
      [AdminProductSort.OLDEST]: Prisma.sql`p."createdAt" ASC`,
      [AdminProductSort.PRICE_ASC]: Prisma.sql`best.price ASC NULLS LAST`,
      [AdminProductSort.PRICE_DESC]: Prisma.sql`best.price DESC NULLS LAST`,
      [AdminProductSort.NAME]: Prisma.sql`p.name ASC`,
    }[query.sort];
    // Lowest active, priced offer per product, from a merchant that is not deleted.
    const best = Prisma.sql`
      SELECT DISTINCT ON (o."productId") o."productId", o.price, o.currency
      FROM "MerchantProduct" o
      JOIN "Merchant" m ON m.id = o."merchantId"
      WHERE o.active AND m."deletedAt" IS NULL AND o.price IS NOT NULL ${merchant}
      ORDER BY o."productId", o.price ASC`;

    const [counted, rows] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM "Product" p JOIN "Brand" b ON b.id = p."brandId" ${where}`,
      this.prisma.$queryRaw<
        { id: string; price: Prisma.Decimal | null; currency: string | null }[]
      >`
        WITH best AS (${best})
        SELECT p.id, best.price, best.currency
        FROM "Product" p
        JOIN "Brand" b ON b.id = p."brandId"
        LEFT JOIN best ON best."productId" = p.id
        ${where}
        ORDER BY ${order}, p.id
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const total = counted[0]?.total ?? 0;
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        barcode: true,
        model: true,
        createdAt: true,
        brand: { select: { name: true } },
        category: { select: { id: true, name: true } },
        images: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { url: true },
        },
        offers: {
          where: { active: true, merchant: { deletedAt: null } },
          orderBy: { merchant: { name: 'asc' } },
          select: { merchant: { select: { id: true, name: true } } },
        },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const items = rows.flatMap((row): AdminProductItem[] => {
      const product = byId.get(row.id);
      if (!product) return [];
      return [
        {
          id: product.id,
          slug: product.slug,
          name: product.name,
          status: product.status,
          barcode: product.barcode,
          model: product.model,
          brand: product.brand.name,
          category: product.category,
          imageUrl: product.images[0]?.url ?? null,
          lowestPrice:
            row.price !== null && row.currency
              ? { amount: row.price.toString(), currency: row.currency }
              : null,
          offerCount: product.offers.length,
          merchants: product.offers.map((offer) => offer.merchant),
          createdAt: product.createdAt.toISOString(),
        },
      ];
    });
    return { items, ...paginationMeta(total, query.page, query.pageSize) };
  }
}
