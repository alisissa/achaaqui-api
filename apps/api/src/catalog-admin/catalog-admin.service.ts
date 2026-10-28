import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { lockCatalogCreation } from '../imports/import-catalog';
import { CatalogImageStorage } from './catalog-image-storage';
import { normalizeCatalogImage, type CatalogUpload } from './catalog-image';
import type {
  CatalogPresentation,
  CreateCatalogCategory,
  UpdateCatalogPresentation,
} from './catalog-admin.dto';

const selection = {
  id: true,
  name: true,
  categoryId: true,
  updatedAt: true,
  images: {
    where: { sortOrder: 0, deletedAt: null },
    select: { url: true, altText: true },
    take: 1,
  },
} as const;
type Selected = {
  id: string;
  name: string;
  categoryId: string;
  updatedAt: Date;
  images: { url: string; altText: string | null }[];
};
const present = (product: Selected): CatalogPresentation => ({
  id: product.id,
  name: product.name,
  categoryId: product.categoryId,
  updatedAt: product.updatedAt.toISOString(),
  image: product.images[0] ?? null,
});

@Injectable()
export class CatalogAdminService {
  private readonly logger = new Logger(CatalogAdminService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CatalogImageStorage,
  ) {}

  async detail(productId: string): Promise<CatalogPresentation> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE' },
      select: selection,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return present(product);
  }

  async update(
    productId: string,
    input: UpdateCatalogPresentation,
    file: CatalogUpload | undefined,
    actorId: string,
  ): Promise<CatalogPresentation> {
    if (input.confirmed !== 'true')
      throw new BadRequestException(
        'Review and confirm this action before saving.',
      );
    const before = await this.detail(productId);
    const image = file ? await normalizeCatalogImage(file) : null;
    const url = image
      ? this.storage.publicUrl(image.filename)
      : before.image?.url;
    const altText = input.altText.trim();
    if (!altText)
      throw new BadRequestException('Image description is required.');
    const same = (product: CatalogPresentation): boolean =>
      product.categoryId === input.categoryId &&
      (!url ||
        (product.image?.url === url && product.image.altText === altText));
    if (same(before)) return before;
    if (before.updatedAt !== input.expectedUpdatedAt)
      throw new ConflictException('Product changed. Refresh and review again.');
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, active: true },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Select an active category.');
    if (image) await this.storage.save(image.filename, image.bytes);
    const result = await this.prisma.$transaction(async (tx) => {
      // A conditional update locks the product row and fails closed on stale previews.
      const changed = await tx.product.updateMany({
        where: {
          id: productId,
          status: 'ACTIVE',
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: {
          categoryId: input.categoryId,
          updatedAt: new Date(
            Math.max(Date.now(), Date.parse(input.expectedUpdatedAt) + 1),
          ),
        },
      });
      if (!changed.count) {
        const current = await tx.product.findFirst({
          where: { id: productId, status: 'ACTIVE' },
          select: selection,
        });
        if (current && same(present(current))) return present(current);
        throw new ConflictException(
          'Product changed. Refresh and review again.',
        );
      }
      const active = await tx.category.findFirst({
        where: { id: input.categoryId, active: true },
        select: { id: true },
      });
      if (!active) throw new ConflictException('Select an active category.');
      if (url)
        await tx.productImage.upsert({
          where: { productId_sortOrder: { productId, sortOrder: 0 } },
          create: {
            productId,
            sortOrder: 0,
            url,
            altText,
            objectKey: image ? `catalog/products/${image.filename}` : null,
          },
          update: {
            url,
            altText,
            ...(image
              ? { objectKey: `catalog/products/${image.filename}` }
              : {}),
          },
        });
      const updated = await tx.product.findUnique({
        where: { id: productId },
        select: selection,
      });
      if (!updated) throw new NotFoundException('Product not found.');
      return present(updated);
    });
    this.logger.log(
      JSON.stringify({
        event: 'catalog_presentation_updated',
        productId,
        actorId,
        categoryId: result.categoryId,
      }),
    );
    return result;
  }

  async category(
    input: CreateCatalogCategory,
    actorId: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    if (input.confirmed !== true)
      throw new BadRequestException(
        'Review and confirm this action before saving.',
      );
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2)
      throw new BadRequestException('Category name is required.');
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCatalogCreation(tx);
      const found = await tx.category.findMany({
        where: {
          OR: [
            { slug: input.slug },
            { name: { equals: name, mode: 'insensitive' } },
          ],
        },
        take: 2,
      });
      if (found.length) {
        if (
          found.length === 1 &&
          found[0].active &&
          found[0].slug === input.slug &&
          found[0].name === name
        )
          return { id: found[0].id, name, slug: input.slug };
        throw new ConflictException(
          'Category already exists with a different name or code.',
        );
      }
      return await tx.category.create({
        data: { name, slug: input.slug },
        select: { id: true, name: true, slug: true },
      });
    });
    this.logger.log(
      JSON.stringify({
        event: 'catalog_category_created',
        categoryId: result.id,
        actorId,
      }),
    );
    return result;
  }

  async image(filename: string): Promise<Buffer> {
    // Only photos still shown on a product are served; soft deleted ones 404.
    const linked = await this.prisma.productImage.findFirst({
      where: { objectKey: `catalog/products/${filename}`, deletedAt: null },
      select: { id: true },
    });
    if (!linked) throw new NotFoundException('Image not found.');
    return await this.storage.read(filename);
  }
}
