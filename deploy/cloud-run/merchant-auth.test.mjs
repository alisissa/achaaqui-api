import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused@127.0.0.1:1/test',
  ADMIN_AUTH_MODE: 'firebase', FIREBASE_PROJECT_ID: 'achaaqui-web',
  CORS_ORIGINS: 'http://localhost', ANALYTICS_HASH_KEY: randomBytes(32).toString('hex'),
});

test('login has an HTTP rate limit and merchant access defaults closed', async () => {
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ConfigService } = require('@nestjs/config');
  const { AppModule } = require('../../apps/api/dist/app.module.js');
  const { PrismaService } = require('../../apps/api/dist/database/prisma.service.js');
  const config = new ConfigService({ MERCHANT_ACCESS_ENABLED: false });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(ConfigService).useValue(config).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const path of ['/v1/merchant/auth/me', '/v1/merchant/offers', '/v1/merchant/catalog/products']) assert.equal((await fetch(base + path)).status, 404);
    for (let i = 0; i < 11; i++) {
      const response = await fetch(base + '/v1/merchant/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i}` },
        body: JSON.stringify({ username: 'not-a-real-store', password: 'not-a-real-password' }),
      });
      assert.equal(response.status, i < 10 ? 404 : 429, 'Forwarded headers cannot bypass the limiter');
    }
  } finally { await app.close(); }
});
