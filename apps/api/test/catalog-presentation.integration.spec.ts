import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { CatalogAdminService } from '../src/catalog-admin/catalog-admin.service';
import { CatalogImageStorage } from '../src/catalog-admin/catalog-image-storage';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const prefix = `image-test-${randomUUID()}`;

run('catalog presentation transactions on an isolated test database', () => {
  let prisma: PrismaService;
  let service: CatalogAdminService;
  let categoryId: string;
  let otherCategoryId: string;
  let brandId: string;
  let productId: string;
  let merchantId: string;
  let buffer: Buffer;
  const saved = new Map<string, Buffer>();
  let failStorage = false;
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await prisma.$connect();
    const storage = {
      publicUrl: (filename: string): string =>
        `https://api.example.test/v1/catalog-images/${filename}`,
      save: (filename: string, bytes: Buffer): Promise<void> => {
        if (failStorage)
          return Promise.reject(new Error('Test storage unavailable'));
        saved.set(filename, bytes);
        return Promise.resolve();
      },
      read: (filename: string): Promise<Buffer> => {
        const bytes = saved.get(filename);
        if (!bytes) throw new Error('Missing fixture');
        return Promise.resolve(bytes);
      },
    };
    service = new CatalogAdminService(prisma, storage as CatalogImageStorage);
    categoryId = (
      await service.category(
        { name: prefix, slug: prefix, confirmed: true },
        'test',
      )
    ).id;
    otherCategoryId = (
      await service.category(
        { name: `${prefix}-new`, slug: `${prefix}-new`, confirmed: true },
        'test',
      )
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: prefix, slug: prefix } })
    ).id;
    productId = (
      await prisma.product.create({
        data: { name: prefix, slug: prefix, categoryId, brandId },
      })
    ).id;
    merchantId = (
      await prisma.merchant.create({ data: { name: prefix, slug: prefix } })
    ).id;
    await prisma.merchantProduct.create({
      data: {
        productId,
        merchantId,
        merchantSku: prefix,
        price: '123.45',
        currency: 'BRL',
        availability: 'UNKNOWN',
        sourceUpdatedAt: new Date(),
      },
    });
    buffer = await sharp({
      create: { width: 200, height: 300, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.merchantProduct.deleteMany({ where: { merchantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.category.deleteMany({
      where: { slug: { startsWith: prefix } },
    });
    await prisma.$disconnect();
  });
  it('should create categories idempotently but reject conflicting names or codes', async () => {
    expect(
      (
        await service.category(
          { name: prefix, slug: prefix, confirmed: true },
          'test',
        )
      ).id,
    ).toBe(categoryId);
    await expect(
      service.category(
        { name: 'Conflicting name', slug: prefix, confirmed: true },
        'test',
      ),
    ).rejects.toThrow('already exists');
  });
  it('should publish a photo and category atomically without touching offers, and allow an identical retry', async () => {
    const before = await service.detail(productId);
    const offerBefore = await prisma.merchantProduct.findFirstOrThrow({
      where: { productId },
    });
    const input = {
      categoryId: otherCategoryId,
      expectedUpdatedAt: before.updatedAt,
      altText: 'Foto do produto',
      confirmed: 'true',
    };
    const updated = await service.update(productId, input, { buffer }, 'test');
    expect(updated.categoryId).toBe(otherCategoryId);
    expect(updated.image?.url).toMatch(/\.webp$/);
    expect(updated.updatedAt).not.toBe(before.updatedAt);
    expect(
      await prisma.merchantProduct.findFirstOrThrow({ where: { productId } }),
    ).toEqual(offerBefore);
    expect(await service.update(productId, input, { buffer }, 'test')).toEqual(
      updated,
    );
    expect(await prisma.productImage.count({ where: { productId } })).toBe(1);
    const filename = updated.image?.url.split('/').at(-1);
    expect(filename).toBeTruthy();
    expect((await service.image(filename ?? '')).length).toBeGreaterThan(0);
  });
  it('should reject a stale edit without overwriting the newer image', async () => {
    const current = await service.detail(productId);
    await expect(
      service.update(
        productId,
        {
          categoryId,
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
          altText: 'Stale',
          confirmed: 'true',
        },
        { buffer },
        'test',
      ),
    ).rejects.toThrow('Product changed');
    expect(await service.detail(productId)).toEqual(current);
  });
  it('should leave catalog records unchanged when storage fails', async () => {
    const current = await service.detail(productId);
    failStorage = true;
    try {
      await expect(
        service.update(
          productId,
          {
            categoryId,
            expectedUpdatedAt: current.updatedAt,
            altText: 'New',
            confirmed: 'true',
          },
          { buffer },
          'test',
        ),
      ).rejects.toThrow('storage unavailable');
      expect(await service.detail(productId)).toEqual(current);
    } finally {
      failStorage = false;
    }
  });
  it('should serialize concurrent edits so only one stale-preview writer succeeds', async () => {
    const current = await service.detail(productId);
    const results = await Promise.allSettled(
      ['One', 'Two'].map((altText) =>
        service.update(
          productId,
          {
            categoryId,
            expectedUpdatedAt: current.updatedAt,
            altText,
            confirmed: 'true',
          },
          undefined,
          'test',
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await prisma.productImage.count({ where: { productId } })).toBe(1);
  });
});
