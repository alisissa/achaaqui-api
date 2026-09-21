# Commercial discovery — local review, 19 September 2026

Local review only: no push, production deployment, Neon migration or TestFlight
upload. Existing uncommitted spreadsheet-import work is preserved. The earlier
build 8 IPA is stale and must not be uploaded as this feature's build.

## Implemented

- Three mobile fixes: pagination on search/category/store listings, catalog
  loading survives optional analytics-storage failures, Best available requires
  a known in-stock offer.
- Static About Us copy in Portuguese and English; no Coming soon menu badge.
- Per-store offer sale prices and optional expiry; separate merchant-entered
  promotion text and optional expiry. No percentage input, bundle calculator,
  checkout or promotion rules engine.
- Admin-selected sponsored offers and stores, homepage only. Labelled Sponsored,
  not Trending. Each section returns up to 12 entries. Sponsored offers must be
  active/in stock with active store/product; sponsored stores must be active.
- Fuzzy customer search; this never changes import identity matching.

## Where to test

- Mobile: Merchant area → select an offer → Promotions and discounts → review →
  explicit confirmation. Editing a hidden offer does not republish it.
- Customer menu: Promotions lists current discounts/promotions with pagination.
  Product/store offer cards also show regular prices and promotional text.
- Admin: merchant catalog has sponsored-store controls; each offer editor has
  separate commercial and sponsored-offer forms. Sponsorship does not change
  search or ordinary price ordering.
- Only UI labels are translated. Names, descriptions and promotion text remain
  as entered. No external OCR/translation provider was called for this slice.

## Pricing and import behavior

- Decimal amounts stay server validated; PYG discounts require whole units.
- Expiry uses server time at read time, including best prices and merchant-offer
  ordering **before pagination**. No scheduler. Mobile uses one deadline refresh
  for displayed terms, not background polling; refresh requires connectivity.
- Price-changing writes record old/new effective prices. Promotion-only edits
  and automatic expiry do not create synthetic price-history rows.
- Changing the regular price or currency ends its discount. A database trigger
  enforces this for manual edits, CSV/XLSX/photo imports and old API binaries.
  Stock-only/unchanged imports preserve it. Imports do not set commercial terms
  yet: use the offer editor after importing.
- Commercial changes update the offer version, invalidating older previews.
  Saving unchanged expired terms does not reactivate them. Changed terms require
  a future expiry or no expiry.
- Mobile dates use YYYY-MM-DD, ending at 23:59 in the device's time zone. Admin
  accepts local date/time. Review shows the expiry; unchanged dates preserve the
  original instant, including seconds. Empty fields remove their terms.

## Contract and SQL

Raw migration: `apps/api/prisma/migrations/20260919130000_commercial_search/migration.sql`.
Adds offer commercial/audit/placement fields and store placement/audit fields,
price CHECK constraints and discount-reset trigger. Enables pg_trgm/unaccent,
backfills Product.searchText, maintains it with product/brand triggers and adds
a GIN index. GIN and partial sponsored indexes are custom SQL, not declared in
Prisma. No new table, enum, service infrastructure or commercial dependency.

- GET `/v1/promotions`: paginated active promotional offers.
- GET `/v1/highlights`: bounded offers and merchants homepage sections.
- PATCH `/v1/merchant/offers/:id/commercial`: authenticated store only.
- PATCH `/v1/admin/merchants/:merchantId/offers/:id/commercial`.
- Admin GET/PATCH `.../merchants/:merchantId/highlight` and PATCH
  `.../merchants/:merchantId/offers/:id/highlight`.

Commercial writes require expectedUpdatedAt, confirmed=true, and four explicit
nullable fields: salePrice, saleEndsAt, promotionText, promotionEndsAt. Highlight
writes require expectedUpdatedAt and sponsored. Public offer price is effective,
with additive nullable regularPrice, saleEndsAt and promotion `{text, endsAt}`.
Existing clients keep their price shape.

Search uses parameterized token/trigram queries over name/model/brand, accent
and spacing normalization, reordered words and exact numeric tokens (15 does
not fuzzily match 16). Category/store filters and deterministic pagination stay.

## Security

Merchant routes derive the store from the session, reject client merchant and
sponsored fields, scope IDs, and recheck session authority inside the write
transaction. Shared offer locks and version comparison reject stale/concurrent
confirmations without duplicate history. Customers/merchants cannot mutate
admin highlights. Public projections omit private SKUs, stock quantities,
credentials and actor fields. Text renders as text, not HTML; SQL is parameterized.
The NestJS/Prisma skill guided guards, DTO validation, transactions and public
projections. This is bounded testing, not a claim of absolute security.

## Verified locally

- API: 134 unit tests, 103 integration tests across seven suites, typecheck,
  lint/build. Raw SQL applied only to disposable PostgreSQL 18.6 databases.
  Coverage includes tenant/admin denial, transactional revocation, concurrency,
  invalid/PYG prices, expiry, hidden offers, price ordering/history, CSV discount
  changes, stale imports, sponsorship visibility and fuzzy/numeric search.
- Admin: 25 tests, typecheck, lint and production build.
- Mobile: 48 tests, typecheck, lint and static web export.
- Real local browser/API checks: merchant review/confirmation/save, admin
  commercial/highlight actions, customer promotions and fuzzy search.
- Native Debug simulator build compiled, installed and rendered against local
  API. Physical iPhone and new TestFlight testing have not been done.

## Local runtime and later release

iPhone 17 Pro simulator: Metro localhost:8081, API localhost:3001.
Browser preview: http://localhost:8099. Admin: http://localhost:3004.
Temporary login details: owner-only
`/private/tmp/achaaqui-commercial-local-access.json`. Do not commit/share it.
Temporary container `achaaqui-commercial-test-20260919` uses localhost port 59227
and tmpfs, no persistent volume. Simulator data is in `achaaqui_commercial_test`;
regression tests used `achaaqui_commercial_verify_test`. Neither is the preserved
catalog database. Removing this container discards only these test fixtures.

Owner simulator review comes next. Later, review/commit exact changes on
branches and obtain rollout approval. Back up the target DB, verify extension
availability and manually apply reviewed SQL. Deploy API before admin/mobile:
the new admin requires new routes. Build a fresh native artifact afterward.
For rollback, restore compatible clients/admin first. Old API binaries can read
the additive schema but do not advertise discounts/promotions, a visible change
not an equivalent fallback. Do not routinely drop columns or rewrite history.
