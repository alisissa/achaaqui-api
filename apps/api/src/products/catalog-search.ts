import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { ProductListQueryDto } from './products.dto';

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Customer discovery only. Never use fuzzy matches to choose import identities.
export async function searchCatalog(
  prisma: PrismaService,
  query: ProductListQueryDto,
): Promise<{ ids: string[]; total: number }> {
  const text = normalizeSearch(query.q ?? '');
  if (!text) return { ids: [], total: 0 };
  const tokens = [...new Set(text.split(/\s+/))].slice(0, 20);
  const conditions = tokens.map((token) =>
    /^\d+$/.test(token)
      ? Prisma.sql`${token} = ANY(string_to_array(p."searchText", ' '))`
      : token.length < 3
        ? Prisma.sql`strpos(p."searchText", ${token}) > 0`
        : Prisma.sql`(p."searchText" LIKE ${'%' + token + '%'} OR ${token} <% p."searchText")`,
  );
  const scope = Prisma.sql`FROM "Product" p JOIN "Category" c ON c.id = p."categoryId"
    WHERE p.status = 'ACTIVE'
      ${query.categorySlug ? Prisma.sql`AND c.slug = ${query.categorySlug} AND c.active` : Prisma.empty}
      ${query.merchantSlug ? Prisma.sql`AND EXISTS (SELECT 1 FROM "MerchantProduct" o JOIN "Merchant" m ON m.id = o."merchantId" WHERE o."productId" = p.id AND o.active AND m.active AND m.slug = ${query.merchantSlug})` : Prisma.empty}
      AND (p.barcode = ${query.q?.trim() ?? ''} OR (${Prisma.join(conditions, ' AND ')}))`;
  return await prisma.$transaction(
    async (tx) => {
      // Transaction-local setting cannot leak into another pooled request.
      await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', '0.35', true)`;
      const counts = await tx.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) AS count ${scope}`,
      );
      const rows = await tx.$queryRaw<
        { id: string }[]
      >(Prisma.sql`SELECT p.id ${scope}
      ORDER BY (p.barcode = ${query.q?.trim() ?? ''}) DESC NULLS LAST,
        (catalog_search_text(p.name) = ${text}) DESC,
        word_similarity(${text}, p."searchText") DESC, p.name, p.id
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      return {
        ids: rows.map((row) => row.id),
        total: Number(counts[0]?.count ?? 0),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
