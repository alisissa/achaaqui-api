// Explicitly owner-authorized maintenance; not an HTTP authentication bypass.
// All catalog writes use existing services inside one outer transaction.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(root + '/package.json');
req('reflect-metadata');
const { Test } = req('@nestjs/testing');
const { ConfigService } = req('@nestjs/config');
const { plainToInstance } = req('class-transformer');
const { validateSync } = req('class-validator');
const { PrismaService } = require(root + '/apps/api/dist/database/prisma.service');
const { MerchantOffersService } = require(root + '/apps/api/dist/merchants/merchant-offers.service');
const { CreateMerchantOfferDto } = require(root + '/apps/api/dist/merchants/merchant-offers.dto');
const { CatalogAdminService } = require(root + '/apps/api/dist/catalog-admin/catalog-admin.service');
const { CatalogImageStorage } = require(root + '/apps/api/dist/catalog-admin/catalog-image-storage');
const { CreateCatalogCategory, UpdateCatalogPresentation } = require(root + '/apps/api/dist/catalog-admin/catalog-admin.dto');
const { normalizeImportRecord } = require(root + '/apps/api/dist/imports/import-normalization');
const { lockCatalogCreation } = require(root + '/apps/api/dist/imports/import-catalog');
const actor = 'owner-authorized-maintenance:Ali-Issa:2026-10-07';
const plan = JSON.parse(fs.readFileSync(__dirname + '/plan.json', 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
function dto(Type, value) {
  const result = plainToInstance(Type, value);
  const errors = validateSync(result, { whitelist: true, forbidNonWhitelisted: true });
  assert.equal(errors.length, 0, 'DTO validation failed: ' + errors.map(e => e.property).join(','));
  return result;
}
function inputFor(row, categoryId) {
  const normalized = normalizeImportRecord({ merchantSku: row.sku, productName: row.name, brand: row.brand, model: row.model, price: '', currency: 'BRL', stock: '', availability: 'UNKNOWN' }, new Set(['BRL']), { allowMissingPrice: true });
  assert.deepEqual(normalized.errors, []);
  assert.deepEqual(normalized.warnings, ['Availability and stock are both unknown.']);
  return dto(CreateMerchantOfferDto, { merchantSku: normalized.data.merchantSku, price: '', priceOnRequest: true, currency: 'BRL', availability: 'UNKNOWN', confirmed: true, confirmWarnings: true, newProduct: { name: normalized.data.productName, brand: normalized.data.brand, model: normalized.data.model, categoryId } });
}
async function snapshot(tx) {
  const tables = await tx.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[A-Za-z_][A-Za-z_0-9]*$/);
    const rows = await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM public."${tablename}" t ORDER BY to_jsonb(t)::text`);
    result[tablename] = Object.fromEntries(rows.map(({ row }) => [row.id || hash(row), hash(row)]));
  }
  return result;
}
async function preview(tx) {
  const merchantIds = plan.merchants.map(m => m.id);
  const merchants = await tx.merchant.findMany({ where: { id: { in: merchantIds } }, orderBy: { id: 'asc' } });
  assert.equal(merchants.length, 2);
  for (const m of plan.merchants) { const found = merchants.find(x => x.id === m.id); assert.equal(found.name, m.name); assert(found.active); }
  const categories = await tx.category.findMany({ orderBy: { id: 'asc' } });
  const brands = await tx.brand.findMany({ orderBy: { id: 'asc' } });
  const products = await tx.product.findMany({ orderBy: { id: 'asc' } });
  const offers = await tx.merchantProduct.findMany({ where: { merchantId: { in: merchantIds } }, orderBy: { id: 'asc' } });
  const operations = [];
  for (const cat of plan.categories) {
    dto(CreateCatalogCategory, { ...cat, confirmed: true });
    const matches = categories.filter(c => c.slug === cat.slug || c.name.toLowerCase() === cat.name.toLowerCase());
    assert(matches.length <= 1, 'Ambiguous category');
    if (matches.length) { assert(matches[0].active); assert.equal(matches[0].slug, cat.slug); assert.equal(matches[0].name, cat.name); }
    operations.push({ type: matches.length ? 'reuse_category' : 'create_category', ...cat });
  }
  for (const merchant of plan.merchants) {
    assert.equal(merchant.products.length, 5);
    const expectedIds = [];
    for (const row of merchant.products) {
      const cat = categories.find(c => c.slug === row.category);
      if (row.existingId) {
        const product = products.find(p => p.id === row.existingId); assert(product && product.status === 'ACTIVE');
        assert.equal(product.name, row.name, 'Existing product changed');
        const own = offers.filter(o => o.productId === row.existingId && o.merchantId === merchant.id); assert.equal(own.length, 1); assert(own[0].active); expectedIds.push(own[0].id);
        operations.push({ type: product.categoryId === cat?.id ? 'preserve_product' : 'categorize_product', merchant: merchant.name, productId: product.id, name: row.name, category: row.category });
      } else {
        inputFor(row, cat?.id || '11111111-1111-4111-8111-111111111111');
        const own = offers.filter(o => o.merchantId === merchant.id && o.merchantSku === row.sku);
        assert(own.length <= 1);
        if (own.length) {
          const product = products.find(p => p.id === own[0].productId); assert.equal(product.name, row.name); assert.equal(product.model, row.model); assert.equal(product.categoryId, cat?.id); assert.equal(brands.find(b => b.id === product.brandId)?.name, row.brand);
          assert(own[0].active); assert.equal(own[0].price, null); assert.equal(own[0].availability, 'UNKNOWN'); expectedIds.push(own[0].id);
        } else {
          assert(!products.some(p => p.name.toLowerCase() === row.name.toLowerCase()), 'Product already exists outside this run; review match');
        }
        operations.push({ type: own.length ? 'preserve_created_product' : 'create_product_and_offer', merchant: merchant.name, name: row.name, model: row.model, brand: row.brand, category: row.category, merchantSku: row.sku, price: null, stock: null, availability: 'UNKNOWN', image: null, source: row.source });
      }
    }
    assert(offers.filter(o => o.merchantId === merchant.id).every(o => expectedIds.includes(o.id)), 'Unreviewed merchant offers appeared');
  }
  const state = json({ merchants, categories, brands, products, offers });
  return { planHash: hash(plan), stateHash: hash(state), operations, snapshot: await snapshot(tx) };
}
async function applyBatch(tx, reviewed, failAfter = -1) {
  await lockCatalogCreation(tx);
  const current = await preview(tx);
  assert.equal(current.planHash, reviewed.planHash, 'Plan changed');
  assert.equal(current.stateHash, reviewed.stateHash, 'Preview stale; no write permitted');
  const transactionPrisma = new Proxy(tx, { get(target, key) { if (['onModuleInit', 'onModuleDestroy', 'onApplicationBootstrap', 'onApplicationShutdown', 'beforeApplicationShutdown'].includes(key)) return undefined; if (key === '$transaction') return async fn => await fn(transactionPrisma); const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  const config = { get: (key, fallback) => key === 'IMPORT_SUPPORTED_CURRENCIES' ? 'BRL,USD,PYG' : fallback };
  const storage = { publicUrl() { throw new Error('Image changes prohibited'); }, save() { throw new Error('Image changes prohibited'); }, read() { throw new Error('Image changes prohibited'); } };
  const module = await Test.createTestingModule({ providers: [{ provide: PrismaService, useValue: transactionPrisma }, { provide: ConfigService, useValue: config }, { provide: CatalogImageStorage, useValue: storage }, MerchantOffersService, CatalogAdminService] }).setLogger(false).compile();
  const catalog = module.get(CatalogAdminService), service = module.get(MerchantOffersService);
  const categories = new Map(); const results = []; let created = 0;
  try {
    for (const category of plan.categories) categories.set(category.slug, await catalog.category(dto(CreateCatalogCategory, { ...category, confirmed: true }), actor));
    for (const merchant of plan.merchants) {
      for (const row of merchant.products) {
        const categoryId = categories.get(row.category).id;
        if (row.existingId) {
          const product = await catalog.detail(row.existingId);
          await catalog.update(product.id, dto(UpdateCatalogPresentation, { categoryId, altText: product.image?.altText || row.name, expectedUpdatedAt: product.updatedAt, confirmed: 'true' }), undefined, actor);
          results.push({ merchantId: merchant.id, productId: product.id, name: row.name, operation: 'preserved_or_categorized' });
        } else {
          const existing = await tx.merchantProduct.findUnique({ where: { merchantId_merchantSku: { merchantId: merchant.id, merchantSku: row.sku } } });
          if (existing) { results.push({ merchantId: merchant.id, productId: existing.productId, name: row.name, operation: 'already_present' }); continue; }
          const result = await service.create(merchant.id, inputFor(row, categoryId), actor); created++;
          results.push({ merchantId: merchant.id, productId: result.product.id, offerId: result.id, name: result.product.name, operation: 'created' });
          if (created === failAfter) throw new Error('INJECTED_REHEARSAL_FAILURE');
        }
      }
    }
    const after = await preview(tx);
    for (const op of after.operations) assert(!op.type.startsWith('create_') && op.type !== 'categorize_product', 'Batch incomplete');
    const changedProductIds = new Set(plan.merchants.flatMap(m => m.products.filter(p => p.existingId).map(p => p.existingId)));
    for (const [table, rows] of Object.entries(current.snapshot)) {
      for (const [id, digest] of Object.entries(rows)) {
        if (table === 'Product' && changedProductIds.has(id)) continue;
        assert.equal(after.snapshot[table][id], digest, 'Unrelated row changed: ' + table + '/' + id);
      }
      if (!['Product', 'MerchantProduct', 'Category', 'Brand'].includes(table)) assert.deepEqual(after.snapshot[table], rows, 'Unexpected table change: ' + table);
    }
    for (const merchant of plan.merchants) assert.equal(await tx.merchantProduct.count({ where: { merchantId: merchant.id, active: true } }), 5);
    return { actor, created, results, after, completedAt: new Date().toISOString() };
  } finally { await module.close(); }
}
async function connect(url) {
  const config = { get: (key, fallback) => ({ DATABASE_URL: url, DATABASE_POOL_MAX: 2, DATABASE_CONNECTION_TIMEOUT_MS: 15000, DATABASE_IDLE_TIMEOUT_MS: 1000 })[key] ?? fallback };
  const module = await Test.createTestingModule({ providers: [{ provide: ConfigService, useValue: config }, PrismaService] }).setLogger(false).compile();
  await module.init(); return { prisma: module.get(PrismaService), close: () => module.close() };
}
async function main() {
  const [mode, evidenceDir, confirmation] = process.argv.slice(2);
  assert(['preview', 'commit', 'verify'].includes(mode)); assert(path.isAbsolute(evidenceDir));
  const parsed = req('dotenv').parse(fs.readFileSync(root + '/apps/api/.env.neon'));
  const url = new URL(parsed.DIRECT_URL); assert(url.hostname.endsWith('.neon.tech')); assert.equal(url.pathname, '/neondb'); url.searchParams.set('sslmode', 'verify-full');
  const connection = await connect(url.toString());
  try {
    if (mode === 'preview') {
      const reviewed = await connection.prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return await preview(tx); }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
      const envelope = { ...reviewed, reviewedAt: new Date().toISOString(), confirmation: hash({ planHash: reviewed.planHash, stateHash: reviewed.stateHash }) };
      save(evidenceDir + '/preview.json', envelope); console.log(JSON.stringify({ confirmation: envelope.confirmation, operations: envelope.operations }, null, 2));
    } else if (mode === 'commit') {
      const reviewed = JSON.parse(fs.readFileSync(evidenceDir + '/preview.json')); assert.equal(confirmation, reviewed.confirmation); assert(Date.now() - Date.parse(reviewed.reviewedAt) < 30 * 60 * 1000, 'Preview expired');
      assert(fs.existsSync(evidenceDir + '/rehearsal.json'), 'Rehearsal evidence required');
      const tested = JSON.parse(fs.readFileSync(evidenceDir + '/rehearsal.json')); assert.equal(tested.scriptHash, hash(fs.readFileSync(__filename, 'utf8'))); assert.equal(tested.planHash, hash(plan)); assert(tested.rollback && tested.idempotent && tested.staleRejected);
      const result = await connection.prisma.$transaction(tx => applyBatch(tx, reviewed), { isolationLevel: 'Serializable', timeout: 60000 });
      save(evidenceDir + '/committed.json', result); console.log(JSON.stringify({ created: result.created, products: result.results, completedAt: result.completedAt }, null, 2));
    } else {
      const result = await connection.prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return await preview(tx); }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
      assert(result.operations.every(op => !op.type.startsWith('create_') && op.type !== 'categorize_product')); save(evidenceDir + '/verified.json', result); console.log('Verified: five products per merchant, correct categories, no pending creation.');
    }
  } finally { await connection.close(); }
}
module.exports = { plan, hash, save, preview, applyBatch, connect };
if (require.main === module) main().catch(error => { console.error(error.code || error.name, error.message?.includes('Preview') || error.message?.includes('Plan') ? error.message : 'Stopped; no credentials printed. Inspect assertion/code locally.', error.code === 'P2028' ? String(error.meta?.error || '').replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]') : ''); process.exitCode = 1; });
