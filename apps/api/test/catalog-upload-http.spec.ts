import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CatalogAdminController } from '../src/catalog-admin/catalog-admin.controller';
import { CatalogAdminService } from '../src/catalog-admin/catalog-admin.service';
import { AdminApiKeyGuard } from '../src/admin-auth/admin-api-key.guard';
import { FirebaseAdminAuthService } from '../src/admin-auth/firebase-admin-auth.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import {
  CatalogProductParam,
  UpdateCatalogPresentation,
} from '../src/catalog-admin/catalog-admin.dto';

describe('catalog upload HTTP boundary', () => {
  let app: INestApplication;
  let url: string;
  const update = vi.fn().mockResolvedValue({ saved: true });
  const key = 'local-test-only-key-'.repeat(3);
  beforeAll(async () => {
    // Vitest's TS transformer does not emit constructor metadata.
    Reflect.defineMetadata(
      'design:paramtypes',
      [CatalogAdminService],
      CatalogAdminController,
    );
    Reflect.defineMetadata(
      'design:paramtypes',
      [CatalogProductParam, UpdateCatalogPresentation, Object, String],
      CatalogAdminController.prototype,
      'update',
    );
    Reflect.defineMetadata(
      'design:paramtypes',
      [ConfigService, FirebaseAdminAuthService],
      AdminApiKeyGuard,
    );
    const module = await Test.createTestingModule({
      controllers: [CatalogAdminController],
      providers: [
        AdminApiKeyGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'test',
            ADMIN_AUTH_MODE: 'local-key',
            ADMIN_API_KEY: key,
          }),
        },
        { provide: FirebaseAdminAuthService, useValue: {} },
        { provide: CatalogAdminService, useValue: { update } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/catalog/products/11111111-1111-4111-8111-111111111111/presentation`;
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => update.mockClear());
  function form(): FormData {
    const f = new FormData();
    f.set('expectedUpdatedAt', '2026-10-07T00:00:00.000Z');
    f.set('categoryId', '22222222-2222-4222-8222-222222222222');
    f.set('altText', 'Perfume');
    f.set('confirmed', 'true');
    f.set('image', new Blob(['fixture']), 'image.png');
    return f;
  }
  async function send(body: FormData, auth = true): Promise<Response> {
    return await fetch(url, {
      method: 'POST',
      body,
      headers: auth ? { Authorization: `Bearer ${key}` } : {},
    });
  }
  it('should require authentication before handling upload bytes', async () => {
    expect((await send(form(), false)).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('should accept one file with four flat fields and derive the actor from the guard', async () => {
    expect((await send(form())).status).toBe(201);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][3]).toBe('local-admin');
  });
  it('should reject oversized files and extra files without invoking the service', async () => {
    const large = form();
    large.set(
      'image',
      new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]),
      'large.png',
    );
    expect((await send(large)).status).toBe(413);
    const extra = form();
    extra.append('image', new Blob(['x']), 'extra.png');
    expect((await send(extra)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('should reject nested and duplicate confirmation fields', async () => {
    const nested = form();
    nested.delete('confirmed');
    nested.set('confirmed[999999999]', 'true');
    expect((await send(nested)).status).toBe(400);
    const duplicate = form();
    duplicate.append('confirmed', 'true');
    expect((await send(duplicate)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('should reject missing confirmation and invalid category IDs through the real validation pipe', async () => {
    const unconfirmed = form();
    unconfirmed.set('confirmed', 'false');
    expect((await send(unconfirmed)).status).toBe(400);
    const invalid = form();
    invalid.set('categoryId', 'not-a-uuid');
    expect((await send(invalid)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
