import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CatalogImageStorage } from './catalog-image-storage';
import { normalizeCatalogImage, type CatalogUpload } from './catalog-image';
import {
  CATALOG_GALLERY_MAX_IMAGES,
  type AddCatalogImage,
  type CatalogGallery,
  type DeleteCatalogImage,
  type ReorderCatalogImages,
} from './catalog-admin.dto';

// Visible photos keep 0..n-1. Reordering passes through this offset so the
// unique (productId, sortOrder) never collides mid-transaction.
const TEMPORARY_POSITION = 1000;

const gallerySelection = {
  id: true,
  updatedAt: true,
  images: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, url: true, altText: true, sortOrder: true },
  },
} as const;
type GallerySelected = {
  id: string;
  updatedAt: Date;
  images: CatalogGallery['images'];
};
const present = (product: GallerySelected): CatalogGallery => ({
  productId: product.id,
  updatedAt: product.updatedAt.toISOString(),
  images: product.images,
});

@Injectable()
export class CatalogGalleryService {
  private readonly logger = new Logger(CatalogGalleryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CatalogImageStorage,
  ) {}

  async gallery(productId: string): Promise<CatalogGallery> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE' },
      select: gallerySelection,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return present(product);
  }

  async add(
    productId: string,
    input: AddCatalogImage,
    file: CatalogUpload | undefined,
    actorId: string,
  ): Promise<CatalogGallery> {
    if (input.confirmed !== 'true')
      throw new BadRequestException(
        'Review and confirm this action before saving.',
      );
    if (!file) throw new BadRequestException('Choose a photo to add.');
    const altText = input.altText.trim();
    if (!altText)
      throw new BadRequestException('Image description is required.');
    const before = await this.gallery(productId);
    const image = await normalizeCatalogImage(file);
    const url = this.storage.publicUrl(image.filename);
    // An identical retry after a successful add returns the same gallery; the
    // same photo with a different description is a conflict, not a silent no op.
    const retried = (gallery: CatalogGallery): boolean => {
      const existing = gallery.images.find((current) => current.url === url);
      if (!existing) return false;
      if (existing.altText === altText) return true;
      throw new ConflictException('This photo is already in the gallery.');
    };
    if (retried(before)) return before;
    if (before.images.length >= CATALOG_GALLERY_MAX_IMAGES)
      throw new ConflictException(
        `A product can have at most ${CATALOG_GALLERY_MAX_IMAGES} photos.`,
      );
    await this.storage.save(image.filename, image.bytes);
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockVersion(tx, productId, input);
      if (current) {
        if (retried(current)) return current;
        throw new ConflictException(
          'Product changed. Refresh and review again.',
        );
      }
      const visible = await tx.productImage.count({
        where: { productId, deletedAt: null },
      });
      if (visible >= CATALOG_GALLERY_MAX_IMAGES)
        throw new ConflictException(
          `A product can have at most ${CATALOG_GALLERY_MAX_IMAGES} photos.`,
        );
      await tx.productImage.create({
        data: {
          productId,
          sortOrder: visible,
          url,
          altText,
          objectKey: `catalog/products/${image.filename}`,
        },
      });
      return await this.read(tx, productId);
    });
    this.log('catalog_image_added', productId, actorId, result);
    return result;
  }

  async reorder(
    productId: string,
    input: ReorderCatalogImages,
    actorId: string,
  ): Promise<CatalogGallery> {
    if (input.confirmed !== true)
      throw new BadRequestException(
        'Review and confirm this action before saving.',
      );
    const before = await this.gallery(productId);
    const matches = (gallery: CatalogGallery): boolean =>
      gallery.images.length === input.imageIds.length &&
      gallery.images.every(
        (image, index) => image.id === input.imageIds[index],
      );
    if (matches(before)) return before;
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockVersion(tx, productId, input);
      if (current) {
        if (matches(current)) return current;
        throw new ConflictException(
          'Product changed. Refresh and review again.',
        );
      }
      const visible = await tx.productImage.findMany({
        where: { productId, deletedAt: null },
        select: { id: true },
      });
      const ids = new Set(visible.map((image) => image.id));
      if (
        visible.length !== input.imageIds.length ||
        !input.imageIds.every((id) => ids.has(id))
      )
        throw new BadRequestException(
          'List every visible photo of this product exactly once.',
        );
      await this.place(tx, input.imageIds);
      return await this.read(tx, productId);
    });
    this.log('catalog_images_reordered', productId, actorId, result);
    return result;
  }

  async remove(
    productId: string,
    imageId: string,
    input: DeleteCatalogImage,
    actorId: string,
  ): Promise<CatalogGallery> {
    if (input.confirmed !== true)
      throw new BadRequestException(
        'Review and confirm this action before saving.',
      );
    const before = await this.gallery(productId);
    const gone = (gallery: CatalogGallery): boolean =>
      !gallery.images.some((image) => image.id === imageId);
    if (gone(before)) {
      const exists = await this.prisma.productImage.findFirst({
        where: { id: imageId, productId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Photo not found.');
      return before;
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockVersion(tx, productId, input);
      if (current) {
        if (gone(current)) return current;
        throw new ConflictException(
          'Product changed. Refresh and review again.',
        );
      }
      const lowest = await tx.productImage.aggregate({
        where: { productId },
        _min: { sortOrder: true },
      });
      // Soft delete only: the row and its stored object stay for history.
      await tx.productImage.update({
        where: { id: imageId },
        data: {
          deletedAt: new Date(),
          deletedBy: actorId,
          sortOrder: Math.min(lowest._min.sortOrder ?? 0, 0) - 1,
        },
      });
      const remaining = await tx.productImage.findMany({
        where: { productId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      await this.place(
        tx,
        remaining.map((image) => image.id),
      );
      return await this.read(tx, productId);
    });
    this.log('catalog_image_deleted', productId, actorId, result, imageId);
    return result;
  }

  /**
   * Locks the product row and bumps its version. Returns null when the caller's
   * version matched, or the current gallery when it is stale.
   */
  private async lockVersion(
    tx: Prisma.TransactionClient,
    productId: string,
    input: { expectedUpdatedAt: string },
  ): Promise<CatalogGallery | null> {
    const changed = await tx.product.updateMany({
      where: {
        id: productId,
        status: 'ACTIVE',
        updatedAt: new Date(input.expectedUpdatedAt),
      },
      data: {
        updatedAt: new Date(
          Math.max(Date.now(), Date.parse(input.expectedUpdatedAt) + 1),
        ),
      },
    });
    if (changed.count) return null;
    const current = await tx.product.findFirst({
      where: { id: productId, status: 'ACTIVE' },
      select: gallerySelection,
    });
    if (!current) throw new NotFoundException('Product not found.');
    return present(current);
  }

  private async place(
    tx: Prisma.TransactionClient,
    imageIds: string[],
  ): Promise<void> {
    for (const [index, id] of imageIds.entries())
      await tx.productImage.update({
        where: { id },
        data: { sortOrder: TEMPORARY_POSITION + index },
      });
    for (const [index, id] of imageIds.entries())
      await tx.productImage.update({
        where: { id },
        data: { sortOrder: index },
      });
  }

  private async read(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<CatalogGallery> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: gallerySelection,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return present(product);
  }

  private log(
    event: string,
    productId: string,
    actorId: string,
    gallery: CatalogGallery,
    imageId?: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        productId,
        actorId,
        ...(imageId ? { imageId } : {}),
        images: gallery.images.length,
      }),
    );
  }
}
