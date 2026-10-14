# Catalog platform

## Product photos and categories — deployed, 7 October 2026

The deployed platform-admin-only catalog presentation API supports reading
and updating a shared product's primary photo, alt text and category:
`GET/POST /v1/admin/catalog/products/:productId/presentation`. POST is multipart:
optional `image`, required `categoryId`, `altText`, `expectedUpdatedAt` and the
literal string `confirmed=true`. Read the product first, preview the exact image
and category, then confirm. `POST /v1/admin/catalog/categories` takes JSON
`{name, slug, confirmed: true}`; identical creation retries reuse the category.
Conflicting names/codes fail closed. Merchant actors cannot use these routes.

Files are bounded to 2 MiB, JPEG/PNG/WebP, one frame, 100px minimum and 16 million
input pixels. Sharp decodes, auto-orients and re-encodes without embedded metadata,
preserving aspect ratio up to 1600px; final WebP is capped at 1 MiB. No user URL is
fetched. The primary image is replaced after explicit confirmation and an optimistic
product-version check, inside a transaction; gallery images and merchant offers,
prices, availability, source timestamps and price history are untouched. Identical
retries are no-ops. Storage failure leaves catalog records unchanged.

Durable storage uses a private GCS bucket configured with `CATALOG_IMAGE_BUCKET`
and `CATALOG_IMAGE_PUBLIC_ORIGIN` (an HTTPS origin, e.g. `https://api.achaaqui.com`).
Keys are `catalog/products/<sha256>.webp`, written create-only. The public
`GET /v1/catalog-images/:filename` serves only objects referenced by ProductImage;
uncommitted uploads cannot be retrieved through it. No disk or database binary
storage, signed-URL expiry, service-account key or schema migration is introduced.
Superseded/orphaned objects are retained: do not apply a blanket age-based deletion
rule, because it could remove currently published photos. Future cleanup must
compare references and be separately approved.

Owner-approved rollout created private, uniform-access
`achaaqui-web-catalog-images` in `us-east4`, project `achaaqui-web`, with public
access prevention enforced. API runtime object create/read grants are conditional
on `catalog/products/`; no public bucket IAM, account keys, credential rotation or
database migration. API `achaaqui-api-00014-2j8` and admin
`achaaqui-admin-00009-pbr` serve 100% traffic. Other service settings and service
IAM were preserved. No catalog records changed during this rollout.
See [release evidence](docs/catalog-images-release-2026-10-07.md).

Local checks: API unit/HTTP tests and isolated PostgreSQL integration tests cover
validation, unauthorized requests, multipart bounds, stale/concurrent edits,
idempotency, failed storage and unchanged offers. Storage is mocked in these tests;
real bucket IAM was read back, but an authenticated production upload/public read
and rendered desktop/narrow UI verification remain unverified. Browser control
currently fails with native pipe startup errors; deployment is not end-to-end QA.

## Production release — 6 October 2026, 16:40 UTC

After the owner's explicit security-fix approval, deployed **Consultar preço**
support and targeted dependency fixes to `achaaqui-web / us-east4`:

- API: `achaaqui-api-00013-6xv`, 100% traffic. Image index
  `sha256:bda466fa4f2ca8f52bc60fc5450db264a0456fc2a07f3178a5659e0ac157d9cc`;
  resolved Linux/amd64 manifest
  `sha256:021084fb082e6af6847dbf05b19fc00da5a389c0fac1957903d7403b972819df`.
- Admin: `achaaqui-admin-00008-p4s`, 100% traffic. Image index
  `sha256:4e45fe834fcc77522d10c22bc5a94b42133afebb640f4637266bd15c2f8dad7d`;
  resolved Linux/amd64 manifest
  `sha256:36c0cfb1e75703608e308deee3e91f3dabe098919dd0a811707a5f8ab6f60173`.
- Applied only `20261006120000_optional_offer_price` at 16:36:56 UTC, with checksum
  `a4652d94013d88614bd0a45c3f9945b73e0fd0a12522f119163847751ac7bfe9` recorded in
  migration history. All existing row hashes matched before/after SQL. Twelve
  completed migrations; 35 offers still have their original prices, zero unpriced
  rows. Public catalog remains 18 products / 3 merchants; nothing was imported.
- Image-only, etag-protected updates preserved runtime identities, service IAM,
  secrets/configuration, probes, scaling, origins and traffic policy. Existing
  EUR 20 alert budget read back; no claim of a hard spending cap. No DNS, Hosting,
  billing, credential rotation, retention-job update or store operation.

Security changes stay within existing dependency major versions: Next.js and
its ESLint config 16.3.8, Sharp 0.35.5, Multer 2.4.0, js-yaml 5.4.3,
proxy-addr 2.0.8, grpc-js 1.14.5, fast-uri 3.1.8, source-map-js 1.2.2 and patched
brace-expansion branches. API full/production npm audits and admin production
audit report zero findings. Admin full audit retains five **development-only**
entries for one unpatched [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
through the ESLint plugin. No exposed app path uses that lint chain; the packaged
admin contains no `braces` package. Do not downgrade Next.js to silence this audit.

Verification: 167 API tests, 124 isolated PostgreSQL integration tests, 29 admin
tests, 10 installed-dependency checks and 6 deployment-template checks passed;
both lint/typecheck/builds passed. Fresh Linux/amd64 images passed 28 isolated
packaging/HTTP/auth/asset checks, including actual Sharp image processing,
patched runtime versions, non-root users and env-file exclusion. After rollout,
36 live read-only HTTP checks passed, legacy and opt-in offer reads agreed,
deployed platform digests matched, service IAM stayed identical, and the bounded
new-revision log check returned zero error/5xx entries. Public admin login rendered
and was visually checked at desktop/narrow widths without browser errors or
horizontal overflow. No signed-in production catalog write or native QA claimed.

Refreshed full backup: mode 0600 at
`/private/tmp/achaaqui-security-rollout-20261006.R1nS7r/neon-before.dump`, 84,897 bytes,
SHA-256 `0e7b8a8279caada2294681130c15affbf4a2303268e24811652279cc508037d3`.
Network-disabled PostgreSQL 18.6 restore and migration rehearsal passed; all 20
table counts/content hashes matched. This contains authentication records and
is temporary local storage, not a durable backup. Do not share or commit it.
Only disposable restore/integration/smoke resources were removed; the original
three containers and retained backups are untouched.

Runtime source remains uncommitted on the existing branches; no Git push occurred.
The reviewed images, full per-file source hashes, previous service configurations,
backup evidence, migration result, live checks and login captures are recorded
in that private release directory. Existing unrelated work was preserved.
Mobile changes still need a new native build. Merchant/product preview and explicit
import confirmation remain the next gate; no Apple/Google submission occurred.

### Initial rollout checkpoint — 6 October 2026 (historical)

Owner approved backup, the optional-price migration, and API/admin deployment.
Production was **not changed**: fresh dependency audits stopped the rollout before
SQL, registry push or deployment. API audit: 8 affected dependency entries
(1 critical, 3 high, 4 moderate); admin: 7 (1 critical, 6 high). These are package
advisories, not evidence of compromise. Targeted dependency remediation and fresh
tests are required before resuming; do not run `npm audit fix --force` blindly.
The critical proxy-addr advisory requires subnet-based proxy trust; live API
`TRUST_PROXY_HOPS=0` does not enable that configuration. Admin source contains no
`next/og` / `ImageResponse` usage implicated in its critical Next.js advisory.
This bounded reachability check does not waive the remaining dependency review.

Verified 11 completed production migrations with matching source checksums,
35 existing offers and zero NULL prices. API stays `achaaqui-api-00012-r4s`, admin
`achaaqui-admin-00007-4ns`. Existing API service min 1/max 1 and admin min 0/max 1
were read, not changed. No catalog records, credentials or store listings changed.

Full backup retained outside source control, mode 0600 inside a private directory:
`/private/tmp/achaaqui-unpriced-release-20261006.ZArv6O/neon-before.dump`
(84,897 bytes; SHA-256 `3c4c12fc73570c9093da6023304c7f0d23e3c8d40939a4285730052740ace638`).
It includes authentication records: never share or commit it. Temporary storage
is not durable backup. Restored successfully to a PostgreSQL 18.6 tmpfs container
with networking disabled and no published ports; all 20 table counts and content
hashes matched. Rehearsed only the optional-price SQL there; stored rows stayed
identical. Removed that restore container/temp data, preserving the backup and
all pre-existing containers. Refresh the backup/live checks before later rollout.
Private verification JSON and helper are alongside the backup.

## Unpriced listings — API/admin deployed, 6 October 2026

Manual create/edit supports `priceOnRequest: true` with `price: ""`. This stores
NULL, never a market estimate or zero, and still requires confirmation, warning
acknowledgement, authorization and the existing per-product locks/version checks.
Blank prices without this explicit selection remain invalid. CSV/XLSX/photo
imports still require positive prices; they can add a real price to a previously
unpriced listing through the existing preview/confirmed/idempotent commit flow.

The reviewed `20261006120000_optional_offer_price` migration and compatible API/admin
are deployed as recorded above; do not reapply the SQL. The compatible mobile
changes remain local, not in a new native release. Public product detail and merchant offers, plus private offer
reads, accept `includeUnpriced=true`; reads without it retain the old non-null
offer contract for installed clients. Best-price calculations, discounts,
promotions and priced freshness exclude unpriced listings. Existing price history
is preserved; an unknown amount does not create a numeric history point. The first
later known price has no previous amount/currency. Exported unpriced rows contain
blank price cells and must be completed before importing.

Rollback to an API that assumes non-null prices is unsafe after any unpriced
record exists (even inactive records). Do not fill missing prices with zero or
delete listings to force rollback. Prefer a compatible forward fix. The database
change is additive to stored values, but schema/client compatibility is mandatory.

Discounts, text promotions, homepage sponsorship, fuzzy search, merchant file
imports and review safeguards were deployed on 21 September 2026. See the
[release record](docs/catalog-review-release-2026-09-21.md) for artifacts,
verification, limitations and rollback precautions.

This repository is the server-side workspace for the catalog product.

- `apps/api` — NestJS REST API and Prisma/PostgreSQL data model.
- `docs` — architecture decisions and the implementation tracker.

The customer app lives in `achaaqui-mobile`, and the operational web app lives in the user-provided `achaaqui-admin` repository. The product name is AchaAqui. Production runs on Cloud Run in `us-east4` with Neon PostgreSQL. Firebase platform-admin authentication and the owner-approved test-only merchant self-service rollout are live. The API is not deployed by this repository's CI.

## Requirements

- Node.js 22.22.3 (see `.nvmrc`)
- npm 11.19.1 (pinned in `packageManager`, Docker, and CI)
- Docker with Compose, or another local PostgreSQL 16+ instance

## Local setup

```bash
nvm use
npm install --global npm@11.19.1
npm ci
cp apps/api/.env.example apps/api/.env
# Replace the two example secret values before starting the API.
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
```

The API is served at `http://localhost:3001/v1`. Swagger UI is at `http://localhost:3001/v1/docs`, and the OpenAPI JSON document is at `http://localhost:3001/v1/openapi.json`. Swagger defaults off outside development. Local shared-key mode requires the server-side bearer key configured as `ADMIN_API_KEY`; production uses Firebase authentication instead.

The owner-approved cloud API is now public, with Swagger explicitly enabled:
[API documentation](https://api.achaaqui.com/v1/docs/). Its root redirects to
`/v1/docs/`; API routes retain `/v1`. Production administrative operations require
a Firebase Google ID token (`Authorization: Bearer <token>`) or an admin-issued
Firebase session (`Authorization: Session <cookie>`). Both require the
`role: platform_admin` claim and a current, enabled, verified Google user with
that role. Shared API keys and merchant-role tokens are rejected in production.
Actor IDs are derived from the verified Firebase UID, never supplied by clients.
See the [current authentication/deployment handoff](../achaaqui-admin/docs/firebase-admin-release.md)
and the historical [public API release](docs/public-api-2026-09-11.md).

Use the declared npm version: older npm 11 workspace resolution can silently
retain vulnerable transitive packages despite root overrides. See the
[dependency remediation and verification](docs/dependency-remediation.md).

## Merchant CSV and Excel imports

Mobile merchant Excel/CSV import is implemented locally for build 8; it has not
been deployed. Session-scoped `/v1/merchant/file-imports` routes reuse these same
parsers and the preview/correction/confirmation pipeline without OCR. See
[the implementation and review handoff](docs/merchant-file-imports.md).

The current import slice exposes protected endpoints under `/v1/admin/imports`
for upload, history, preview, commit, and cancellation. The canonical fields are
`merchantSku`, `productName`, `brand`, `model`, `barcode`, `price`, `currency`,
`stock`, `availability`, and optional `category`; common English and Portuguese aliases are also
accepted.

Parsing writes staging rows only. Matching uses an existing merchant SKU first
and an exact product barcode second. Invalid or uncertain rows never commit.
Unmatched rows with a name and brand propose a **new catalog product** and
merchant listing. They are created together only after an additional explicit
confirmation bound to the exact preview. Names never automatically match products.
Category accepts an existing category name; blank uses Uncategorized with a warning.
Duplicate barcodes remain blocked. See [new-product imports](docs/import-product-creation.md).
For new products, a nonblank barcode must contain 8, 12, 13 or 14 digits and
cannot repeat a single digit; use a real barcode or leave it blank. Brand spelling
aliases with the same slug reuse the brand. Existing identifiers are unchanged.
When approved for release, deploy the API before the admin; roll back in reverse.
Commits are explicit, transactional, and idempotent per import. Warning rows
require an unchecked operator acknowledgement. Overlapping imports for one
offer are serialized and stale previews are rejected. Actual price or currency
changes create truthful price history; unchanged rows only refresh the offer
source timestamp and never reactivate an offer. CSV and XLSX share this pipeline,
with limits of 500 rows/2 MB. Protected downloads provide blank CSV/XLSX templates
or a merchant's current active offers for editing and re-uploading. Excel inputs
are bounded before parsing and reject formulas, numeric barcodes, unsafe numeric
SKUs, hidden rows, merged cells, macros, and extra data sheets. Nonnegative integer
SKUs of at most 15 digits with plain number formatting are accepted with an
explicit leading-zero warning that must be acknowledged, even for unchanged
rows. Keep identifiers as Text whenever possible. Boolean availability values
are accepted; stock contradictions still fail validation. Native Apple Numbers
files must be exported to Excel (.xlsx) or CSV. Saved custom mappings remain deferred.

Imports never rename an existing merchant SKU: a barcode match under a different
SKU is blocked, including for removed listings. Commit also rejects unsafe older
previews, and concurrent SKU collisions return a conflict without partial writes.
See [the step-1 safety fixes and verification](docs/admin-safety-step1.md).

## Individual merchant offers

The [photo-import review](docs/photo-import-review-2026-09-18.md) documents the
new mobile camera/gallery source, editable row errors, partial commits and
remaining-row correction. It reuses the existing import pipeline and stays
disabled by default in code. Production photo access was enabled on 19 September
2026 after explicit secret-transfer approval and a successful preview/cancel test.
See [the rollout record](docs/photo-import-release-2026-09-18.md). Build 7 fixed
native upload transport; the owner subsequently confirmed photo importing works.

The protected `/v1/admin/merchants/:merchantId/offers` endpoints support listing,
adding, editing, removing, and restoring merchant offers. Operators can select an
existing catalog product or create a new product and its first offer atomically.
Removal hides only the merchant's offer and preserves shared products and history.
Explicit confirmation, optimistic versions, and the same transaction locks as
imports protect manual edits. These are administrator-operated workflows, not
merchant self-service authentication.

A new [mobile merchant access slice](docs/mobile-merchant-access.md) adds
username/password sessions and scoped manual offer routes. It remains
**disabled by default** in configuration; the owner-approved test-only deployment
enabled it on 15 September 2026 after the additive migration. See the
[release record](docs/merchant-release-2026-09-15.md), including remaining gates
before real merchant onboarding.

See [merchant workflows and template rules](docs/merchant-workflows.md), the
[local testing checklist](../achaaqui-admin/docs/merchant-testing.md), and the
[GCP migration plan](docs/gcp-migration-plan.md). Cloud and DNS changes are not
part of this implementation.

## Anonymous product reviews (deployed 16 September 2026)

Review reporting, personal reviewer blocking, the admin report queue, comment
filter and reviewer bans were deployed on 21 September 2026. See the
[release record](docs/catalog-review-release-2026-09-21.md) and
[scoped implementation handoff](docs/review-safety-local.md).

The [product-review slice](docs/product-reviews.md) adds immediately published
1–5 stars plus an optional comment, one per anonymous app identity per product.
Platform admins can hide reviews. The reviewed SQL migration and compatible
admin/API are deployed, with `PRODUCT_REVIEWS_ENABLED=true` in production; the
code default remains false. See [the release record](docs/reviews-release-2026-09-16.md).
Old admin/API versions cannot read product-only reviews, even if the flag is off.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:deployment
npm run test:integration
npm run build
```

See [docs/architecture-decisions.md](docs/architecture-decisions.md) for current technical decisions and [docs/implementation-tracker.md](docs/implementation-tracker.md) for scope and status.

## Cloud Run preparation

The [API-only deployment review](docs/cloud-run-api.md) includes a private-first
service template, scale-to-zero settings, explicit connection-pool limits, and
secret/IAM approval gates. Builds exclude local environment files and need no
database credentials. `npm run test:deployment` validates the intended template
offline; it never contacts GCP. No cloud deployment, automatic push, admin rollout,
or domain change is included.
