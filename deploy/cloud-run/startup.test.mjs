import { createRequire } from 'node:module';
import test from 'node:test';

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
