import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';

const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error(
    'Retention tests require a disposable localhost test database.',
  );
(url ? describe : describe.skip)('one-shot retention job', () => {
  let prisma: PrismaService;
  const prefix = `retention-${randomUUID()}`;
  const hash = randomBytes(32).toString('hex');
  let merchantId: string;
  let productId: string;
  let brandId: string;
  let categoryId: string;
  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await prisma.$connect();
    merchantId = (
      await prisma.merchant.create({ data: { name: prefix, slug: prefix } })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: prefix, slug: prefix } })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { name: prefix, slug: prefix } })
    ).id;
    productId = (
      await prisma.product.create({
        data: { name: prefix, slug: prefix, brandId, categoryId },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.searchEvent.deleteMany({ where: { query: prefix } });
    await prisma.reviewDeletionReceipt.deleteMany({
      where: { reviewerHash: hash },
    });
    await prisma.product.deleteMany({ where: { slug: prefix } });
    await prisma.merchant.deleteMany({ where: { slug: prefix } });
    await prisma.brand.deleteMany({ where: { slug: prefix } });
    await prisma.category.deleteMany({ where: { slug: prefix } });
    await prisma.$disconnect();
  });
  it('fails closed when disabled; removes only expired analytics and receipts; is safe to rerun', async () => {
    const day = 86_400_000;
    for (const days of [91, 89])
      await prisma.searchEvent.create({
        data: {
          query: prefix,
          normalizedQuery: prefix,
          resultCount: 1,
          page: 1,
          pageSize: 20,
          createdAt: new Date(Date.now() - days * day),
          merchantHits: { create: { merchantId, productId } },
        },
      });
    for (const days of [2, 0])
      await prisma.reviewDeletionReceipt.create({
        data: {
          reviewerHash: hash,
          createdAt: new Date(Date.now() - days * day),
        },
      });
    const run = (enabled: boolean): ReturnType<typeof spawnSync> =>
      spawnSync(process.execPath, ['dist/analytics/retention-job.js'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          DATABASE_URL: url,
          DOTENV_CONFIG_PATH: '/dev/null',
          RETENTION_JOB_ENABLED: String(enabled),
          ANALYTICS_RETENTION_DAYS: '1', // Job must retain its fixed 90-day policy.
        },
      });
    expect(run(false).status).not.toBe(0);
    expect(await prisma.searchEvent.count({ where: { query: prefix } })).toBe(
      2,
    );
    const first = run(true);
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(await prisma.searchEvent.count({ where: { query: prefix } })).toBe(
      1,
    );
    expect(
      await prisma.searchMerchantHit.count({ where: { merchantId } }),
    ).toBe(1);
    expect(
      await prisma.reviewDeletionReceipt.count({
        where: { reviewerHash: hash },
      }),
    ).toBe(1);
    const second = run(true);
    expect(second.status).toBe(0);
    expect(String(second.stdout)).toContain('"analyticsDeleted":0');
    expect(String(second.stdout)).toContain('"receiptsDeleted":0');
    expect(await prisma.product.count({ where: { id: productId } })).toBe(1);
  }, 60000);
});
