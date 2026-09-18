import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PhotoOcrService,
  parsePhotoExtraction,
  PHOTO_UNCERTAIN_ERROR,
} from '../src/imports/photo-ocr.service';
import { CANONICAL_IMPORT_FIELDS } from '../src/imports/import-normalization';

const row = (): Record<string, unknown> => ({
  ...Object.fromEntries(CANONICAL_IMPORT_FIELDS.map((field) => [field, null])),
  merchantSku: '00123',
  productName: 'Caixa',
  price: '1.299,00',
  currency: 'BRL',
  stock: '0',
  availability: 'FALSE',
  uncertain: false,
});
const service = (): PhotoOcrService =>
  new PhotoOcrService(
    new ConfigService({
      MISTRAL_API_KEY: 'test-only-key-not-a-real-provider-key',
    }),
  );
afterEach(() => vi.unstubAllGlobals());

describe('photo OCR boundary', () => {
  it('preserves identifiers, raw prices, blanks, false and zero without translation', () => {
    const [parsed] = parsePhotoExtraction({ rows: [row()] });
    expect(parsed.rawData).toMatchObject({
      merchantSku: '00123',
      price: '1.299,00',
      barcode: '',
      stock: '0',
      availability: 'FALSE',
    });
  });
  it('blocks uncertain rows and rejects missing/oversized/malformed extraction', () => {
    expect(
      parsePhotoExtraction({ rows: [{ ...row(), uncertain: true }] })[0].errors,
    ).toEqual([PHOTO_UNCERTAIN_ERROR]);
    for (const value of [
      null,
      {},
      { rows: [] },
      { rows: Array.from({ length: 101 }, row) },
      { rows: [{ ...row(), price: 10 }] },
      { rows: [{ ...row(), merchantSku: 'a'.repeat(501) }] },
    ])
      expect(() => parsePhotoExtraction(value)).toThrow();
  });
  it('decodes and strips EXIF/GPS metadata rather than trusting filename or MIME', async () => {
    const buffer = await sharp({
      create: { width: 200, height: 150, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ exif: { IFD0: { Artist: 'private metadata' } } })
      .jpeg()
      .toBuffer();
    const clean = await service().sanitize({
      buffer,
      size: buffer.length,
      originalname: 'anything',
      mimetype: 'text/plain',
    });
    const meta = await sharp(clean).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(200);
    for (const buffer of [
      Buffer.from('<svg></svg>'),
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    ])
      await expect(
        service().sanitize({
          buffer,
          size: buffer.length,
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
        }),
      ).rejects.toThrow();
  });
  it('uses fixed HTTPS endpoint, no redirects, and validates annotation at runtime', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            document_annotation: JSON.stringify({ rows: [row()] }),
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await service().extract(Buffer.from('test')))[0].rawData.merchantSku,
    ).toBe('00123');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/ocr');
    expect(options?.redirect).toBe('error');
    expect((JSON.parse(String(options?.body)) as { model: string }).model).toBe(
      'mistral-ocr-4-1',
    );
  });
  it('hides provider error bodies and does not retry paid calls', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('secret-provider-body', { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service().extract(Buffer.from('test'))).rejects.toThrow(
      'PHOTO_PROVIDER_BUSY',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed and oversized provider responses', async () => {
    for (const body of [
      'not json',
      JSON.stringify({ document_annotation: '{broken' }),
      'x'.repeat(2 * 1024 * 1024 + 1),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(service().extract(Buffer.from('test'))).rejects.toThrow(
        'PHOTO_EXTRACTION_INVALID',
      );
    }
  });
});
