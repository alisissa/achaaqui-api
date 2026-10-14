import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as sharpModule from 'sharp';
const sharp =
  typeof sharpModule === 'function' ? sharpModule : sharpModule.default;

export const CATALOG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_IMAGE_OUTPUT_MAX_BYTES = 1024 * 1024;
export interface CatalogUpload {
  buffer: Buffer;
}

export async function normalizeCatalogImage(
  file: CatalogUpload,
): Promise<{ bytes: Buffer; filename: string }> {
  if (!file.buffer.length || file.buffer.length > CATALOG_IMAGE_MAX_BYTES)
    throw new BadRequestException('Use a JPEG, PNG or WebP image up to 2 MB.');
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width < 100 ||
      metadata.height < 100
    )
      throw new Error('Unsupported image');
    // Decode/re-encode without EXIF/GPS or other source metadata; never fetch a URL.
    const bytes = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
    if (bytes.length > CATALOG_IMAGE_OUTPUT_MAX_BYTES)
      throw new Error('Image too large');
    return {
      bytes,
      filename: `${createHash('sha256').update(bytes).digest('hex')}.webp`,
    };
  } catch {
    throw new BadRequestException(
      'Use a readable, single-frame JPEG, PNG or WebP image, at least 100 × 100 pixels.',
    );
  }
}
