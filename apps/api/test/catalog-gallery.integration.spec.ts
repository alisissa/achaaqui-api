import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { CatalogAdminService } from '../src/catalog-admin/catalog-admin.service';
import { CatalogGalleryService } from '../src/catalog-admin/catalog-gallery.service';
import { CatalogImageStorage } from '../src/catalog-admin/catalog-image-storage';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const prefix = `gallery-test-${randomUUID()}`;

// Fixtures stay in place: this suite only runs against a disposable database.
run('catalog gallery on an isolated test database', () => {
  let prisma: PrismaService;
  let gallery: CatalogGalleryService;
  let presentation: CatalogAdminService;
  let categoryId: string;
  let brandId: string;
  const saved = new Map<string, Buffer>();

  // Random noise so every fixture normalizes to a different WebP file;
  // near identical solid colors can encode to the same bytes.
  const photo = async (): Promise<{ buffer: Buffer }> => ({
    buffer: await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: 'white',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer(),
  });
  const product = async (): Promise<string> =>
    (
      await prisma.product.create({
        data: {
          name: `${prefix}-${randomUUID()}`,
          slug: `${prefix}-${randomUUID()}`,
          categoryId,
          brandId,
        },
      })
    ).id;
  const add = async (productId: string): Promise<string> => {
    const current = await gallery.gallery(productId);
    const result = await gallery.add(
      productId,
      {
        expectedUpdatedAt: current.updatedAt,
        altText: 'Foto',
        confirmed: 'true',
      },
      await photo(),
      'test',
    );
    return result.images.at(-1)!.id;
  };

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await prisma.$connect();
    const storage = {
      publicUrl: (filename: string): string =>
        `https://api.example.test/v1/catalog-images/${filename}`,
      save: (filename: string, bytes: Buffer): Promise<void> => {
        saved.set(filename, bytes);
        return Promise.resolve();
      },
      read: (filename: string): Promise<Buffer> =>
        Promise.resolve(saved.get(filename)!),
    } as CatalogImageStorage;
    gallery = new CatalogGalleryService(prisma, storage);
    presentation = new CatalogAdminService(prisma, storage);
    categoryId = (
      await prisma.category.create({ data: { name: prefix, slug: prefix } })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: prefix, slug: prefix } })
    ).id;
  });

  it('should append photos in order and treat an identical retry as done', async () => {
    const productId = await product();
    await add(productId);
    const second = await photo();
    const start = await gallery.gallery(productId);
    const added = await gallery.add(
      productId,
      {
        expectedUpdatedAt: start.updatedAt,
        altText: 'Foto',
        confirmed: 'true',
      },
      second,
      'test',
    );
    expect(added.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    // The client retries with its old version after a lost response.
    const retried = await gallery.add(
      productId,
      {
        expectedUpdatedAt: start.updatedAt,
        altText: 'Foto',
        confirmed: 'true',
      },
      second,
      'test',
    );
    expect(retried.images).toHaveLength(2);
    await expect(
      gallery.add(
        productId,
        {
          expectedUpdatedAt: retried.updatedAt,
          altText: 'Outra descrição',
          confirmed: 'true',
        },
        second,
        'test',
      ),
    ).rejects.toThrow('already in the gallery');
  });

  it('should stop serving a soft deleted photo unless another visible photo uses it', async () => {
    const productId = await product();
    const shared = await photo();
    const start = await gallery.gallery(productId);
    const added = await gallery.add(
      productId,
      {
        expectedUpdatedAt: start.updatedAt,
        altText: 'Foto',
        confirmed: 'true',
      },
      shared,
      'test',
    );
    const image = added.images[0];
    const filename = image.url.split('/').at(-1)!;
    await expect(presentation.image(filename)).resolves.toBeInstanceOf(Buffer);
    const otherId = await product();
    const other = await gallery.gallery(otherId);
    await gallery.add(
      otherId,
      {
        expectedUpdatedAt: other.updatedAt,
        altText: 'Foto',
        confirmed: 'true',
      },
      shared,
      'test',
    );
    await gallery.remove(
      productId,
      image.id,
      { expectedUpdatedAt: added.updatedAt, confirmed: true },
      'test',
    );
    // Still visible on the second product, so the bytes stay available.
    await expect(presentation.image(filename)).resolves.toBeInstanceOf(Buffer);
    const remaining = await gallery.gallery(otherId);
    await gallery.remove(
      otherId,
      remaining.images[0].id,
      { expectedUpdatedAt: remaining.updatedAt, confirmed: true },
      'test',
    );
    await expect(presentation.image(filename)).rejects.toThrow(
      'Image not found',
    );
  });

  it('should reject a stale add and an eighth plus one photo', async () => {
    const productId = await product();
    const first = await gallery.gallery(productId);
    await add(productId);
    await expect(
      gallery.add(
        productId,
        {
          expectedUpdatedAt: first.updatedAt,
          altText: 'Foto',
          confirmed: 'true',
        },
        await photo(),
        'test',
      ),
    ).rejects.toThrow('Product changed');
    for (let index = 1; index < 8; index += 1) await add(productId);
    await expect(add(productId)).rejects.toThrow('at most 8 photos');
  });

  it('should reorder visible photos and make the first one the main photo', async () => {
    const productId = await product();
    const ids = [
      await add(productId),
      await add(productId),
      await add(productId),
    ];
    const current = await gallery.gallery(productId);
    const reordered = await gallery.reorder(
      productId,
      {
        expectedUpdatedAt: current.updatedAt,
        imageIds: [ids[2], ids[0], ids[1]],
        confirmed: true,
      },
      'test',
    );
    expect(reordered.images.map((image) => image.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
    expect(reordered.images.map((image) => image.sortOrder)).toEqual([0, 1, 2]);
    await expect(
      gallery.reorder(
        productId,
        {
          expectedUpdatedAt: reordered.updatedAt,
          imageIds: [ids[0], ids[1]],
          confirmed: true,
        },
        'test',
      ),
    ).rejects.toThrow('exactly once');
  });

  it('should soft delete a photo, keep its row and compact the rest', async () => {
    const productId = await product();
    const ids = [
      await add(productId),
      await add(productId),
      await add(productId),
    ];
    const current = await gallery.gallery(productId);
    const after = await gallery.remove(
      productId,
      ids[0],
      { expectedUpdatedAt: current.updatedAt, confirmed: true },
      'firebase:owner',
    );
    expect(after.images.map((image) => image.id)).toEqual([ids[1], ids[2]]);
    expect(after.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    const kept = await prisma.productImage.findUnique({
      where: { id: ids[0] },
    });
    expect(kept?.deletedAt).toBeInstanceOf(Date);
    expect(kept?.deletedBy).toBe('firebase:owner');
    expect(kept?.sortOrder).toBeLessThan(0);

    // Deleting again is a no op, and a second delete gets its own position.
    const again = await gallery.remove(
      productId,
      ids[0],
      { expectedUpdatedAt: after.updatedAt, confirmed: true },
      'test',
    );
    expect(again.images).toHaveLength(2);
    const next = await gallery.remove(
      productId,
      ids[1],
      { expectedUpdatedAt: again.updatedAt, confirmed: true },
      'test',
    );
    expect(next.images.map((image) => image.id)).toEqual([ids[2]]);
    const total = await prisma.productImage.count({ where: { productId } });
    expect(total).toBe(3);
  });

  it('should keep the single photo editor working after photos are deleted', async () => {
    const productId = await product();
    const id = await add(productId);
    const current = await gallery.gallery(productId);
    await gallery.remove(
      productId,
      id,
      { expectedUpdatedAt: current.updatedAt, confirmed: true },
      'test',
    );
    const before = await presentation.detail(productId);
    expect(before.image).toBeNull();
    const updated = await presentation.update(
      productId,
      {
        expectedUpdatedAt: before.updatedAt,
        categoryId,
        altText: 'Principal',
        confirmed: 'true',
      },
      await photo(),
      'test',
    );
    expect(updated.image?.altText).toBe('Principal');
    const visible = await gallery.gallery(productId);
    expect(visible.images.map((image) => image.sortOrder)).toEqual([0]);
  });

  it('should let only one of two concurrent adds win on the same version', async () => {
    const productId = await product();
    const current = await gallery.gallery(productId);
    const [first, second] = await Promise.all([photo(), photo()]);
    const results = await Promise.allSettled([
      gallery.add(
        productId,
        {
          expectedUpdatedAt: current.updatedAt,
          altText: 'A',
          confirmed: 'true',
        },
        first,
        'test',
      ),
      gallery.add(
        productId,
        {
          expectedUpdatedAt: current.updatedAt,
          altText: 'B',
          confirmed: 'true',
        },
        second,
        'test',
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const final = await gallery.gallery(productId);
    expect(final.images.map((image) => image.sortOrder)).toEqual([0]);
  });
});
