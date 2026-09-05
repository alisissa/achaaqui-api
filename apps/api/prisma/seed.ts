import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PriceChangeSource,
  PrismaClient,
  ReviewStatus,
} from '../src/generated/prisma/client';
import {
  brands,
  categories,
  merchants,
  offers,
  products,
  reviews,
} from './seed-data';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seed(): Promise<void> {
  await prisma.$transaction(
    categories.map((category) =>
      prisma.category.upsert({
        where: { slug: category.slug },
        create: category,
        update: category,
      }),
    ),
  );

  await prisma.$transaction(
    brands.map((brand) =>
      prisma.brand.upsert({
        where: { slug: brand.slug },
        create: brand,
        update: brand,
      }),
    ),
  );

  await prisma.$transaction(
    merchants.map((merchant) =>
      prisma.merchant.upsert({
        where: { slug: merchant.slug },
        create: merchant,
        update: merchant,
      }),
    ),
  );

  const [storedCategories, storedBrands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.brand.findMany({ select: { id: true, slug: true } }),
  ]);
  const categoryIds = new Map(
    storedCategories.map((category) => [category.slug, category.id]),
  );
  const brandIds = new Map(storedBrands.map((brand) => [brand.slug, brand.id]));

  await prisma.$transaction(
    products.map((product) => {
      const categoryId = categoryIds.get(product.categorySlug);
      const brandId = brandIds.get(product.brandSlug);

      if (!categoryId || !brandId) {
        throw new Error(`Missing seed relation for ${product.slug}`);
      }

      const data = {
        slug: product.slug,
        name: product.name,
        description: product.description,
        model: product.model,
        barcode: product.barcode,
        categoryId,
        brandId,
        featured: product.featured,
        popularityScore: product.popularityScore,
      };

      return prisma.product.upsert({
        where: { slug: product.slug },
        create: data,
        update: data,
      });
    }),
  );

  const [storedProducts, storedMerchants] = await Promise.all([
    prisma.product.findMany({ select: { id: true, slug: true } }),
    prisma.merchant.findMany({ select: { id: true, slug: true } }),
  ]);
  const productIds = new Map(
    storedProducts.map((product) => [product.slug, product.id]),
  );
  const merchantIds = new Map(
    storedMerchants.map((merchant) => [merchant.slug, merchant.id]),
  );
  const now = Date.now();

  await prisma.$transaction(
    products.map((product) => {
      const productId = productIds.get(product.slug);

      if (!productId) {
        throw new Error(`Missing image relation for ${product.slug}`);
      }

      return prisma.productImage.upsert({
        where: { productId_sortOrder: { productId, sortOrder: 0 } },
        create: {
          productId,
          url: product.imageUrl,
          altText: product.name,
          sortOrder: 0,
        },
        update: {
          url: product.imageUrl,
          altText: product.name,
        },
      });
    }),
  );

  await prisma.$transaction(
    offers.map((offer) => {
      const productId = productIds.get(offer.productSlug);
      const merchantId = merchantIds.get(offer.merchantSlug);

      if (!productId || !merchantId) {
        throw new Error(`Missing offer relation for ${offer.merchantSku}`);
      }

      const data = {
        productId,
        merchantId,
        merchantSku: offer.merchantSku,
        price: offer.price,
        currency: offer.currency,
        availability: offer.availability,
        stockQuantity: offer.stockQuantity,
        sourceUpdatedAt: new Date(now - offer.ageHours * 60 * 60 * 1000),
        active: true,
      };

      return prisma.merchantProduct.upsert({
        where: {
          merchantId_merchantSku: {
            merchantId,
            merchantSku: offer.merchantSku,
          },
        },
        create: data,
        update: data,
      });
    }),
  );

  const storedOffers = await prisma.merchantProduct.findMany({
    select: {
      id: true,
      merchant: { select: { slug: true } },
      product: { select: { slug: true } },
    },
  });
  const offerIds = new Map(
    storedOffers.map((offer) => [
      `${offer.merchant.slug}:${offer.product.slug}`,
      offer.id,
    ]),
  );

  await prisma.$transaction(
    reviews.map((review) => {
      const merchantProductId = offerIds.get(
        `${review.merchantSlug}:${review.productSlug}`,
      );
      if (!merchantProductId) {
        throw new Error(`Missing review relation for ${review.id}`);
      }
      const createdAt = new Date(
        now - review.createdDaysAgo * 24 * 60 * 60 * 1000,
      );
      const pending = review.status === ReviewStatus.PENDING;
      const data = {
        merchantProductId,
        productRating: review.productRating,
        merchantRating: review.merchantRating,
        reviewerDisplayName: review.reviewerDisplayName,
        title: review.title,
        comment: review.comment,
        status: review.status,
        createdAt,
        moderatedAt: pending ? null : new Date(createdAt.getTime() + 3_600_000),
        moderatedBy: pending ? null : 'local-seed',
      };

      return prisma.customerReview.upsert({
        where: { id: review.id },
        create: { id: review.id, ...data },
        update: data,
      });
    }),
  );

  const historyOffers = await prisma.merchantProduct.findMany({
    where: {
      merchantSku: {
        in: ['NST-IP16-128', 'PM-PS5-2026', 'NST-XM5-BLK'],
      },
    },
    select: { id: true, merchantSku: true, price: true, currency: true },
  });

  await prisma.priceHistory.deleteMany({
    where: { source: PriceChangeSource.SEED },
  });
  await prisma.priceHistory.createMany({
    data: historyOffers.flatMap((offer) => [
      {
        merchantProductId: offer.id,
        oldPrice: offer.price.plus(30),
        oldCurrency: offer.currency,
        newPrice: offer.price.plus(15),
        currency: offer.currency,
        source: PriceChangeSource.SEED,
        actorId: 'local-seed',
        changedAt: new Date(now - 21 * 24 * 60 * 60 * 1000),
      },
      {
        merchantProductId: offer.id,
        oldPrice: offer.price.plus(15),
        oldCurrency: offer.currency,
        newPrice: offer.price,
        currency: offer.currency,
        source: PriceChangeSource.SEED,
        actorId: 'local-seed',
        changedAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
      },
    ]),
  });
}

seed()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    process.exitCode = 1;
    throw error;
  });
