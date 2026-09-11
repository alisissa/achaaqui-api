import {
  Body,
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { request } from 'node:http';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { MAX_IMPORT_BYTES } from '../src/imports/import-file';
import { IMPORT_UPLOAD_OPTIONS } from '../src/imports/import-upload-options';

const received = vi.fn();
const merchantId = '11111111-1111-4111-8111-111111111111';

// Exercise the real Nest/Multer middleware and shared production upload options,
// without database writes or a new test-only dependency such as supertest.
@Controller()
class UploadHarnessController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  upload(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: { size: number },
  ): { size: number; merchantId: unknown } {
    received();
    return { size: file.size, merchantId: body.merchantId };
  }
}

describe('import upload security', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadHarnessController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/upload`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => received.mockClear());

  function form(size = 16): FormData {
    const body = new FormData();
    body.set('merchantId', merchantId);
    body.set('file', new Blob([new Uint8Array(size)]), 'catalog.csv');
    return body;
  }

  async function send(body: FormData): Promise<Response> {
    return await fetch(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    });
  }

  it('should accept one file and the flat merchant identifier', async () => {
    const response = await send(form());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ size: 16, merchantId });
    expect(received).toHaveBeenCalledOnce();
  });

  it('should accept the exact file limit and reject one byte over it', async () => {
    expect((await send(form(MAX_IMPORT_BYTES))).status).toBe(201);
    expect((await send(form(MAX_IMPORT_BYTES + 1))).status).toBe(413);
    expect(received).toHaveBeenCalledOnce();
  });

  it.each(['merchantId[4294967294]', 'merchantId[x][y]', 'merchantId[]'])(
    'should reject nested field %s before reaching the handler',
    async (field) => {
      const body = form();
      body.delete('merchantId');
      body.set(field, merchantId);
      expect((await send(body)).status).toBe(400);
      expect(received).not.toHaveBeenCalled();
    },
  );

  it('should reject duplicate fields and additional files', async () => {
    const duplicateField = form();
    duplicateField.append('merchantId', merchantId);
    expect((await send(duplicateField)).status).toBe(400);

    const extraFile = form();
    extraFile.append('file', new Blob(['extra']), 'extra.csv');
    expect((await send(extraFile)).status).toBe(400);
    expect(received).not.toHaveBeenCalled();
  });

  it('should bound text field names and values', async () => {
    const longValue = form();
    longValue.set('merchantId', 'x'.repeat(257));
    expect((await send(longValue)).status).toBe(400);

    const longName = form();
    longName.delete('merchantId');
    longName.set('x'.repeat(65), merchantId);
    expect((await send(longName)).status).toBe(400);
    expect(received).not.toHaveBeenCalled();
  });

  it('should recover after an aborted multipart upload', async () => {
    await new Promise<void>((resolve) => {
      const upload = request(url, {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=test-abort',
          'content-length': 10_000,
        },
      });
      upload.on('error', () => resolve());
      upload.on('close', () => resolve());
      upload.write(
        '--test-abort\r\nContent-Disposition: form-data; name="file"; filename="test.csv"\r\nContent-Type: text/csv\r\n\r\npartial',
        () => setTimeout(() => upload.destroy(), 25),
      );
    });
    expect((await send(form())).status).toBe(201);
    expect(received).toHaveBeenCalledOnce();
  });
});
