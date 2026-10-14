import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { CATALOG_IMAGE_OUTPUT_MAX_BYTES } from './catalog-image';

@Injectable()
export class CatalogImageStorage {
  constructor(private readonly config: ConfigService) {}

  private file(
    filename: string,
  ): ReturnType<ReturnType<ReturnType<typeof getStorage>['bucket']>['file']> {
    const bucket = this.config.get<string>('CATALOG_IMAGE_BUCKET');
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    if (!bucket || !projectId)
      throw new ServiceUnavailableException(
        'Product image storage is not configured.',
      );
    const name = `achaaqui-api-${projectId}`;
    const app =
      getApps().find((candidate) => candidate.name === name) ??
      initializeApp({ projectId, credential: applicationDefault() }, name);
    return getStorage(app).bucket(bucket).file(`catalog/products/${filename}`);
  }

  publicUrl(filename: string): string {
    const origin = this.config.get<string>('CATALOG_IMAGE_PUBLIC_ORIGIN');
    if (!origin)
      throw new ServiceUnavailableException(
        'Product image storage is not configured.',
      );
    return `${origin}/v1/catalog-images/${filename}`;
  }

  async save(filename: string, bytes: Buffer): Promise<void> {
    const file = this.file(filename);
    try {
      await file.save(bytes, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    } catch (error: unknown) {
      // Immutable content-addressed objects make identical retries safe.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 412
      )
        return;
      throw new ServiceUnavailableException(
        'Could not store the product image. No catalog changes were saved.',
      );
    }
  }

  async read(filename: string): Promise<Buffer> {
    const file = this.file(filename);
    try {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size);
      if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > CATALOG_IMAGE_OUTPUT_MAX_BYTES
      )
        throw new Error('Invalid stored image');
      // Bound even a malformed object; public requests cannot choose arbitrary keys.
      const [bytes] = await file.download({
        start: 0,
        end: CATALOG_IMAGE_OUTPUT_MAX_BYTES,
      });
      if (bytes.length !== size) throw new Error('Invalid stored image');
      return bytes;
    } catch {
      throw new ServiceUnavailableException(
        'Product image is temporarily unavailable.',
      );
    }
  }
}
