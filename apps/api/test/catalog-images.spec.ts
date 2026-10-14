import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizeCatalogImage,
  CATALOG_IMAGE_MAX_BYTES,
} from '../src/catalog-admin/catalog-image';
import { CatalogAdminService } from '../src/catalog-admin/catalog-admin.service';
import { CatalogImageStorage } from '../src/catalog-admin/catalog-image-storage';
import {
  CreateCatalogCategory,
  UpdateCatalogPresentation,
} from '../src/catalog-admin/catalog-admin.dto';
import type { PrismaService } from '../src/database/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('catalog image normalization', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'should decode %s and produce an immutable metadata-free image',
    async (format) => {
      const buffer = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: 'red' },
      })
        .withMetadata()
        .toFormat(format)
        .toBuffer();
      const normalized = await normalizeCatalogImage({ buffer });
      const metadata = await sharp(normalized.bytes).metadata();
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 1600,
        height: 800,
      });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(normalized.filename).toMatch(/^[a-f0-9]{64}\.webp$/);
      expect((await normalizeCatalogImage({ buffer })).filename).toBe(
        normalized.filename,
      );
    },
  );
  it('should reject SVG, corrupt bytes, undersized and oversized images', async () => {
    const small = await sharp({
      create: { width: 99, height: 100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    for (const buffer of [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"></svg>',
      ),
      Buffer.from('not an image'),
      small,
      Buffer.alloc(CATALOG_IMAGE_MAX_BYTES + 1),
    ])
      await expect(normalizeCatalogImage({ buffer })).rejects.toThrow();
  });
});

describe('catalog contracts and write boundaries', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const version = '2026-10-07T00:00:00.000Z';
  it('should require literal multipart confirmation and a valid product revision', async () => {
    const input = {
      expectedUpdatedAt: version,
      categoryId: id,
      altText: 'Perfume',
      confirmed: 'true',
    };
    expect(
      await validate(plainToInstance(UpdateCatalogPresentation, input)),
    ).toHaveLength(0);
    for (const change of [
      { confirmed: 'false' },
      { confirmed: true },
      { expectedUpdatedAt: 'bad' },
      { categoryId: '../x' },
    ])
      expect(
        (
          await validate(
            plainToInstance(UpdateCatalogPresentation, { ...input, ...change }),
          )
        ).length,
      ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(CreateCatalogCategory, {
            name: 'Perfumes',
            slug: '../perfumes',
            confirmed: true,
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('should reject unconfirmed and stale updates before storing an image or opening a transaction', async () => {
    const transaction = vi.fn();
    const save = vi.fn();
    const prisma = {
      product: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id,
            name: 'Perfume',
            categoryId: id,
            updatedAt: new Date(version),
            images: [],
          }),
      },
      $transaction: transaction,
    };
    const service = new CatalogAdminService(
      prisma as unknown as PrismaService,
      { save } as unknown as CatalogImageStorage,
    );
    const input = {
      expectedUpdatedAt: version,
      categoryId: '22222222-2222-4222-8222-222222222222',
      altText: 'Perfume',
      confirmed: 'false',
    };
    await expect(
      service.update(id, input, undefined, 'actor'),
    ).rejects.toThrow();
    await expect(
      service.update(
        id,
        {
          ...input,
          confirmed: 'true',
          expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        },
        undefined,
        'actor',
      ),
    ).rejects.toThrow('Product changed');
    expect(save).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('should not serve uncommitted or unknown object keys', async () => {
    const read = vi.fn();
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new CatalogAdminService(
      prisma as unknown as PrismaService,
      { read } as unknown as CatalogImageStorage,
    );
    await expect(service.image('a'.repeat(64) + '.webp')).rejects.toThrow(
      'Image not found',
    );
    expect(read).not.toHaveBeenCalled();
  });
  it('should fail closed when durable storage is not configured', async () => {
    const storage = new CatalogImageStorage(new ConfigService());
    expect(() => storage.publicUrl('a.webp')).toThrow('not configured');
    await expect(storage.save('a.webp', Buffer.from('x'))).rejects.toThrow(
      'not configured',
    );
  });
});
