import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import type { NormalizedImportRow } from './import-normalization';

export function catalogText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function catalogSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110);
}

export const NEW_PRODUCT_BARCODE_ERROR =
  'New product barcodes must contain 8, 12, 13, or 14 digits and cannot repeat one digit. Enter a real barcode or leave it blank.';
export const CATALOG_BRAND_ERROR =
  'The brand is inactive or ambiguous. Review the catalog before creating products.';

export function validNewProductBarcode(barcode: string | null): boolean {
  return (
    !barcode ||
    (/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode) &&
      !/^(\d)\1+$/.test(barcode))
  );
}

export function catalogBrandWhere(name: string): Prisma.BrandWhereInput {
  const slug = catalogSlug(name);
  return {
    OR: [
      { name: { equals: name, mode: 'insensitive' } },
      ...(slug ? [{ slug }] : []),
    ],
  };
}

export function catalogBrandMatches(
  brand: { name: string; slug: string },
  name: string,
): boolean {
  return (
    catalogText(brand.name) === catalogText(name) ||
    (!!catalogSlug(name) && brand.slug === catalogSlug(name))
  );
}

// Callers hold the shared catalog creation lock. Ambiguous or inactive matches
// fail closed instead of creating a second brand or reviving an inactive one.
export async function resolveCatalogBrand(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<{ id: string }> {
  const found = await tx.brand.findMany({
    where: catalogBrandWhere(name),
    select: { id: true, active: true },
    take: 2,
  });
  if (found.length > 1 || (found[0] && !found[0].active))
    throw new ConflictException(CATALOG_BRAND_ERROR);
  return (
    found[0] ??
    (await tx.brand.create({
      data: {
        name,
        slug: catalogSlug(name) || `brand-${randomUUID().slice(0, 8)}`,
      },
      select: { id: true },
    }))
  );
}

export function productDraftKey(
  row: NormalizedImportRow,
  brandKey = catalogSlug(row.brand ?? '') || catalogText(row.brand ?? ''),
): string {
  return JSON.stringify([
    brandKey,
    catalogText(row.productName ?? ''),
    catalogText(row.model ?? ''),
  ]);
}

// Catalog creation is infrequent and bounded. One transaction lock shared with
// manual creation avoids duplicate races and lock-order complexity for v1.
export async function lockCatalogCreation(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('catalog:create', 0))`,
  );
}

export interface NewImportProduct {
  id: string;
  data: NormalizedImportRow;
}

export async function createImportProducts(
  tx: Prisma.TransactionClient,
  drafts: readonly NewImportProduct[],
): Promise<void> {
  if (!drafts.length) return;
  await lockCatalogCreation(tx);
  if (drafts.some(({ data }) => !validNewProductBarcode(data.barcode)))
    throw new ConflictException(NEW_PRODUCT_BARCODE_ERROR);
  const barcodes = drafts.flatMap(({ data }) =>
    data.barcode ? [data.barcode] : [],
  );
  const existing = await tx.product.findMany({
    where: {
      OR: [
        { barcode: { in: barcodes } },
        ...drafts.map(({ data }) => ({
          name: {
            equals: data.productName ?? '',
            mode: 'insensitive' as const,
          },
          brand: catalogBrandWhere(data.brand ?? ''),
          model: data.model
            ? { equals: data.model, mode: 'insensitive' as const }
            : null,
        })),
      ],
    },
    select: { id: true },
  });
  if (existing.length)
    throw new ConflictException(
      'A proposed product now exists in the catalog. Upload again and review its existing record before committing.',
    );

  const brands = new Map<string, string>();
  const categories = new Map<string, string>();
  // Resolve each distinct reference once, not once per spreadsheet row.
  for (const { data } of drafts) {
    if (!data.productName || !data.brand)
      throw new ConflictException(
        'Product name and brand are required for new products.',
      );
    const brandKey = catalogText(data.brand);
    if (!brands.has(brandKey)) {
      const brand = await resolveCatalogBrand(tx, data.brand);
      brands.set(brandKey, brand.id);
    }
    const categoryKey = catalogText(data.category ?? '');
    if (!categories.has(categoryKey)) {
      const found = await tx.category.findMany({
        where: data.category
          ? { name: { equals: data.category, mode: 'insensitive' } }
          : { slug: 'uncategorized' },
        select: { id: true, active: true },
        take: 2,
      });
      if (
        found.length > 1 ||
        (found[0] && !found[0].active) ||
        (data.category && !found.length)
      ) {
        throw new ConflictException(
          'The category is missing, inactive, or ambiguous. Upload again with an active category or leave it blank.',
        );
      }
      const category =
        found[0] ??
        (await tx.category.create({
          data: { name: 'Uncategorized', slug: 'uncategorized' },
          select: { id: true },
        }));
      categories.set(categoryKey, category.id);
    }
  }
  const identities = drafts.map(({ data }) =>
    productDraftKey(data, brands.get(catalogText(data.brand ?? ''))),
  );
  if (new Set(identities).size !== identities.length)
    throw new ConflictException(
      'Multiple new rows have the same name, brand, and model. Clarify the variants before importing.',
    );
  await tx.product.createMany({
    data: drafts.map(({ id, data }) => {
      const brandId = brands.get(catalogText(data.brand ?? ''));
      const categoryId = categories.get(catalogText(data.category ?? ''));
      if (!brandId || !categoryId || !data.productName)
        throw new ConflictException(
          'New product references could not be resolved.',
        );
      return {
        id,
        name: data.productName,
        brandId,
        categoryId,
        slug: `${catalogSlug(data.productName) || 'product'}-${id}`,
        barcode: data.barcode,
        model: data.model,
      };
    }),
  });
}
