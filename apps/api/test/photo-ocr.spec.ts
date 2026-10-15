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
// Test double: a fixed token instead of Google application default credentials.
class TestOcr extends PhotoOcrService {
  token: () => Promise<string> = () => Promise.resolve('test-only-token');
  protected override accessToken(): Promise<string> {
    return this.token();
  }
}
const service = (): TestOcr =>
  new TestOcr(new ConfigService({ FIREBASE_PROJECT_ID: 'achaaqui-web' }));
const gemini = (rows: unknown, finishReason = 'STOP'): string =>
  JSON.stringify({
    candidates: [
      {
        finishReason,
        content: { parts: [{ text: JSON.stringify({ rows }) }] },
      },
    ],
  });
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
      .mockResolvedValue(new Response(gemini([row()]), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await service().extract(Buffer.from('test')))[0].rawData.merchantSku,
    ).toBe('00123');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/achaaqui-web/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(options?.redirect).toBe('error');
    expect((options?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-only-token',
    );
    if (typeof options?.body !== 'string')
      throw new Error('Expected JSON body');
    const body = JSON.parse(options.body) as {
      generationConfig: { temperature: number; responseMimeType: string };
    };
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: 'application/json',
    });
  });
  it('reports the reader as unavailable when no Google credential is available', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const ocr = service();
    ocr.token = () => Promise.reject(new Error('no credentials'));
    await expect(ocr.extract(Buffer.from('test'))).rejects.toThrow(
      'PHOTO_UNAVAILABLE',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('flattens transparent PNGs onto white before JPEG encoding', async () => {
    const buffer = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const clean = await service().sanitize({
      buffer,
      size: buffer.length,
      originalname: 'sheet.png',
      mimetype: 'image/png',
    });
    const { data, info } = await sharp(clean)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });
  it('hides provider error bodies and retries only a throttled call, once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const busy = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response('secret-provider-body', { status: 429 }),
          ),
        );
      vi.stubGlobal('fetch', busy);
      const throttled = service().extract(Buffer.from('test'));
      const assertion = expect(throttled).rejects.toThrow(
        'PHOTO_PROVIDER_BUSY',
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await assertion;
      expect(busy).toHaveBeenCalledTimes(2);

      const failing = vi
        .fn()
        .mockResolvedValue(
          new Response('secret-provider-body', { status: 500 }),
        );
      vi.stubGlobal('fetch', failing);
      await expect(service().extract(Buffer.from('test'))).rejects.toThrow(
        'PHOTO_UNAVAILABLE',
      );
      expect(failing).toHaveBeenCalledTimes(1);

      const recovers = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response(gemini([row()]), { status: 200 }));
      vi.stubGlobal('fetch', recovers);
      const read = service().extract(Buffer.from('test'));
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await read)[0].rawData.merchantSku).toBe('00123');
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects malformed and oversized provider responses', async () => {
    for (const body of [
      'not json',
      JSON.stringify({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } },
        ],
      }),
      gemini([row()], 'MAX_TOKENS'),
      'x'.repeat(2 * 1024 * 1024 + 1),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(service().extract(Buffer.from('test'))).rejects.toThrow(
        'PHOTO_EXTRACTION_INVALID',
      );
    }
  });
});
