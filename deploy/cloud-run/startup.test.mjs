import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

test('compiled application resolves authentication dependencies in every feature module', async () => {
  // Test emitted Nest metadata, not the transpiler's isolated unit-test classes.
  // Replacing Prisma prevents any local or production database connection.
  const previous = { ...process.env };
  let module;
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://check:check@127.0.0.1:1/check',
      ADMIN_AUTH_MODE: 'firebase',
      FIREBASE_PROJECT_ID: 'achaaqui-web',
      CORS_ORIGINS: 'https://achaaqui.com',
      ANALYTICS_HASH_KEY: 'startup-test-only-not-a-production-secret-12345',
    });
    const { Test } = require('@nestjs/testing');
    const { AppModule } = require('../../apps/api/dist/app.module.js');
    const { PrismaService } = require('../../apps/api/dist/database/prisma.service.js');
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  } finally {
    await module?.close();
    process.env = previous;
  }
});

test('every compiled admin HTTP operation rejects unauthorized identities', async (t) => {
  const previous = { ...process.env };
  const cwd = process.cwd();
  const emptyDirectory = mkdtempSync(join(tmpdir(), 'achaaqui-admin-boundary-'));
  let app;
  try {
    // ConfigModule must not discover local .env files. No Firebase or DB access:
    // the real verifier/guards/controllers run against an SDK stub and empty Prisma.
    process.chdir(emptyDirectory);
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://check:check@127.0.0.1:1/check',
      ADMIN_AUTH_MODE: 'firebase',
      FIREBASE_PROJECT_ID: 'achaaqui-web',
      CORS_ORIGINS: 'https://achaaqui.com',
      ANALYTICS_HASH_KEY: 'boundary-test-only-not-a-production-secret-12345',
    });
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const { Test } = require('@nestjs/testing');
    const { ThrottlerStorage } = require('@nestjs/throttler');
    const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
    const { AppModule } = require('../../apps/api/dist/app.module.js');
    const { PrismaService } = require('../../apps/api/dist/database/prisma.service.js');
    const { FirebaseAdminAuthService } = require('../../apps/api/dist/admin-auth/firebase-admin-auth.service.js');
    const { MerchantsService } = require('../../apps/api/dist/merchants/merchants.service.js');
    const { AllExceptionsFilter } = require('../../apps/api/dist/common/filters/all-exceptions.filter.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({})
      // Rate limiting is not under test here; avoid turning auth failures into 429s.
      .overrideProvider(ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    const approvedClaims = { uid: 'fixture-admin', role: 'platform_admin', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
    const approvedUser = { disabled: false, emailVerified: true, customClaims: { role: 'platform_admin' } };
    let identity = {};
    let sdkCalls = 0;
    const verify = async (_token, checkRevoked) => {
      sdkCalls++;
      assert.equal(checkRevoked, true);
      if (identity.invalid) throw new Error('Invalid test credential');
      return { ...approvedClaims, ...identity.claims };
    };
    t.mock.method(module.get(FirebaseAdminAuthService), 'auth', () => ({
      verifyIdToken: verify,
      verifySessionCookie: verify,
      getUser: async () => ({ ...approvedUser, ...identity.user }),
    }));
    const adminList = t.mock.method(module.get(MerchantsService), 'adminList', async () => ({ items: [] }));
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/v1/admin/'))
      .flatMap(([path, methods]) => Object.keys(methods)
        .filter(method => ['get', 'post', 'patch', 'delete', 'put'].includes(method))
        .map(method => ({ method: method.toUpperCase(), path: path.replace(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111') })));
    assert.equal(operations.length, 21, 'Review coverage when an admin route is added');
    // Credential management is deliberately omitted from public Swagger, but
    // remains covered by exactly the same real administrator guard tests.
    for (const method of ['GET', 'POST', 'PATCH']) operations.push({ method, path: '/v1/admin/merchants/11111111-1111-4111-8111-111111111111/login' });
    for (const scenario of [
      { name: 'anonymous', header: undefined, status: 401, noSdk: true },
      { name: 'forged headers without credentials', header: 'Basic forged', status: 401, noSdk: true },
      { name: 'invalid/expired token or old shared key', header: 'Bearer invalid', status: 401, invalid: true },
      { name: 'revoked session', header: 'Session invalid', status: 401, invalid: true },
      { name: 'customer without an admin role', header: 'Bearer customer', status: 403, claims: { role: undefined } },
      { name: 'merchant A token with copied store B IDs', header: 'Bearer merchant-a', status: 403, claims: { role: 'merchant', merchantId: 'merchant-a' } },
      { name: 'merchant B session', header: 'Session merchant-b', status: 403, claims: { role: 'merchant', merchantId: 'merchant-b' } },
      { name: 'admin whose role was removed', header: 'Session old-admin', status: 403, user: { customClaims: {} } },
      { name: 'disabled admin', header: 'Bearer disabled', status: 401, user: { disabled: true } },
      { name: 'unverified admin', header: 'Bearer unverified', status: 403, claims: { email_verified: false } },
      { name: 'non-Google provider', header: 'Bearer password', status: 403, claims: { firebase: { sign_in_provider: 'password' } } },
    ]) {
      await t.test(scenario.name, async () => {
        identity = scenario;
        sdkCalls = 0;
        for (const { method, path } of operations) {
          const response = await fetch(`${base}${path}`, {
            method,
            headers: {
              ...(scenario.header ? { Authorization: scenario.header } : {}),
              'X-Actor-Id': 'forged-admin',
              'X-Merchant-Id': 'merchant-b',
              'X-Role': 'platform_admin',
            },
            signal: AbortSignal.timeout(5_000),
          });
          assert.equal(response.status, scenario.status, `${method} ${path}`);
          const body = await response.json();
          assert.equal(body.statusCode, scenario.status);
          assert.equal('items' in body, false);
          assert.equal('stack' in body, false);
        }
        if (scenario.noSdk) assert.equal(sdkCalls, 0);
        assert.equal(adminList.mock.callCount(), 0);
      });
    }
    await t.test('approved reads are private/no-store even without the Hosting proxy', async () => {
      identity = {};
      for (const scheme of ['Bearer', 'Session']) {
        const response = await fetch(`${base}/v1/admin/merchants`, { headers: { Authorization: `${scheme} approved` } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), { items: [] });
      }
      assert.equal(adminList.mock.callCount(), 2);
    });
    assert.equal((await fetch(`${base}/v1/health`)).status, 200);
  } finally {
    await app?.close();
    process.chdir(cwd);
    process.env = previous;
    rmdirSync(emptyDirectory);
  }
});
