# Photo imports — review handoff, 18 September 2026

## Status and scope

Implementation and pre-release verification are complete. This handoff describes
the reviewed code, not live rollout status. Production release evidence is tracked
separately; do not infer enablement from these local checks.
The earlier API/mobile checkpoint commits (`0796335` / `4c2d4fd`) contained
unfinished photo work alongside prior merchant access/review/localization work.
The follow-up fixes described here are a separate review diff.
Admin and public homepage code are unchanged in this follow-up.
Much of the mobile line-count diff is formatting of the existing photo screen
and helper files, not additional screens or architecture.

Merchant mobile flow:

1. Open **Import from photo**, then take a photo or choose an image.
2. Read a table/list of products, including a screenshot of Excel or CSV.
3. Show a preview with original input, proposed price, matched product and errors.
4. Correct a row in a form, skip it, or leave invalid rows out of the commit.
5. Visit every preview page, confirm reviewed values, and separately acknowledge
   catalog/price warnings and creation of any new catalog products.
6. Import valid rows transactionally. Show imported/unchanged/not-imported counts.
7. **Resolve remaining rows** opens only invalid or explicitly skipped rows;
  previously successful rows are not retried. Save corrections, review, confirm.
  Cancelling a correction import does not prevent opening another remainder.

Interface text is Portuguese/English. Merchant product text is never translated.
No product photos, arbitrary PDF documents, OCR queues, fuzzy matching, discounts,
new admin screen or new login system are included.

## Matching and errors

- Use existing merchant SKU first, then exact barcode, exactly like CSV/XLSX.
- A barcode matching a shared product is not itself an error: it may legitimately
  attach a new store's offer to that product.
- A barcode identifying an existing offer under another SKU is blocked. Show the
  existing SKU and explain how to use it; never recommend inventing a barcode.
- SKU/barcode disagreement, duplicates, invalid prices and inactive products stay
  row errors. Invalid rows never commit. Fixing/skipping a duplicate revalidates
  every remaining row in that preview.
- New products require name and brand. Unknown barcodes may remain blank, with
  the existing explicit warning. New nonblank barcodes retain the existing
  length/repeated-digit checks. Names are not automatic matches.
- Every photo row carries a manual-review warning, even if OCR reports confidence.
  A row marked uncertain by OCR is blocked until the operator corrects/saves it.
- Preview revisions cover stored values, decisions and timestamps. Changing any
  row invalidates the previous confirmation. Manual listing changes between
  preview/commit also reject the commit. Saving a correction revalidates the
  preview against current catalog data; merely reading it does not.
- Original OCR raw cells remain unchanged for audit. Corrections are stored
  separately in the row's normalized input.

## API and security

All routes are under `/v1/merchant/imports`:

- `POST /photo` — one multipart `file`; no tenant/body metadata accepted.
- `GET /` — latest 20 photo imports belonging to the session's store.
- `GET /:id` — scoped preview.
- `PATCH /:id/rows/:rowId` — `{ expectedPreviewToken, input, skip }`.
- `POST /:id/commit` — preview token, `confirmed`, `reviewedPhoto`,
  `confirmWarnings`, and `confirmNewProducts` when applicable.
- `POST /:id/cancel` — preview token.
- `POST /:id/remaining` — idempotently creates/returns a correction import after
  a partial commit. It uses no further OCR call.

`MerchantAccessGuard` runs before multipart processing. The store comes only
from the verified session. Services scope import/row access to that store and
PHOTO source; foreign IDs return 404. Merchant credentials cannot authorize admin
routes. Each write rechecks merchant/session authority inside its transaction.
Revocation during OCR prevents staging the result. Public catalog routes cannot
read these imports. Existing private/no-store middleware covers merchant routes.

The API calls only the fixed HTTPS Mistral OCR endpoint, with redirects rejected.
The key stays server-side. Clients cannot submit image URLs for server fetching.
Merchant payloads, image bodies, keys and provider error bodies are not logged;
photo-path 5xx responses/logs suppress exception stacks that could contain them.
This is bounded verification, not a guarantee of zero vulnerabilities.

## OCR, dependencies and limits

- Model: `mistral-ocr-4-1`, structured document annotation.
- API dependency: `sharp` 0.35.4. Mobile: Expo-compatible
  `expo-image-picker` and `expo-image-manipulator`.
- Accept JPEG/PNG bytes, not filename/MIME assertions. Decode and re-encode;
  reject corrupt, animated, tiny or over-16-megapixel images. Strip EXIF/GPS and
  resize to a maximum 2600-pixel edge before sending to Mistral.
- One image, maximum 5 MB / 100 extracted rows. Mobile retains PNG output for PNG
  inputs and re-encodes other supported native formats as JPEG. The backend
  flattens transparency to white before its JPEG conversion.
- Provider timeout 40 seconds; bounded 2 MB response; no automatic paid retries.
- One in-flight OCR per API process. Persistent reservation limits: 3/minute and
  20/day per store, 20/day globally, UTC reset. Failed reservations count.
  Correction imports also count conservatively toward these totals.
- Limits reduce abuse/cost but are not a monthly spending guarantee. Revisit the
  global limit against the owner's total budget before enabling real merchants.
  Concurrent reads now report a reader-busy message, distinct from quota limits.
- Reads stuck in processing for over five minutes are marked failed lazily when
  that merchant reads imports. No scheduler; no cross-merchant cleanup.
- Images are not persisted by the API. The provider receives the sanitized image;
  the screen says this before selection. Provider retention/account terms need
  owner review before real merchant data. Device/picker temporary image caches
  are not claimed to be erased by this feature.

No request writes products before confirmation. Transactions/idempotency and
price-history behavior are shared with CSV/XLSX. History source is PHOTO.

## Schema and rollout requirements

Only `20260918100000_photo_imports/migration.sql` is added for this feature. It
adds PHOTO to ImportSource and PriceChangeSource; there is no new table.
Apply reviewed raw SQL, not Prisma migrate, only after rollout approval. Both
enum statements use IF NOT EXISTS and run separately in autocommit mode.

`PHOTO_IMPORT_ENABLED=false` by default. Enabling requires a server-only
`MISTRAL_API_KEY`; never place it in an Expo public variable. The existing
`MERCHANT_ACCESS_ENABLED` gate is also required.

The owner approved rollout; an additional explicit secret-transfer approval is
required by the execution safety gate. Until then, deploy with photo access off.
Deploy
compatible API code with photo access disabled, verify the existing catalog and
merchant workflows, then enable photo access and cut a new native build.
Do not reuse build 5's native binary for the new camera/picker modules.

Rollback caveat: after PHOTO rows exist, an API binary generated before this enum
addition may fail reading them, including public price history. Turning the flag
off hides photo merchant endpoints but does not remove existing PHOTO rows.
Keep an enum-compatible rollback image; do not promise rollback to the old image.

## Verification

All database tests target a separately labeled disposable PostgreSQL 18.6
container, loopback-only, tmpfs, no persistent volume. The preserved local
catalog and Neon production are not used.

Verified locally during this follow-up:

- 131 API unit/HTTP tests; 84 PostgreSQL integration tests, including the real
  compiled image decoder with mocked provider extraction.
- API lint/typecheck/build, 8 dependency checks and 6 deployment-template checks.
- Mobile lint/typecheck/web export (18 routes) and 35 translation/helper tests.
- Admin lint/typecheck/build and 25 tests; no admin code changes in this follow-up.
- Fresh API, admin and mobile npm audits: zero known advisories at check time.
- Linux/amd64 Alpine production images: real sharp 0.35.4 transparent-PNG decode
  passed, white pixels verified, metadata stripped; non-root and no env files.
  Public reads, 21 denied admin operations, protected photo routes, merchant
  ownership, and Google-only admin login/protected redirects passed locally.
- Additional fixture browser run: 11 rows across two pages, confirmation blocked
  until both pages visited and warnings accepted; unchecked warning blocks again.
  Confirmed 11 rows using mocked OCR, zero external calls and browser errors.
  Mobile/desktop screenshots: `/private/tmp/achaaqui-photo-release.ZhhOLk/`.
- Signed internal-only iOS build 6 archived/exported and artifact-verified locally;
  not uploaded. See mobile `docs/testflight-build-6.md`.
- Integration cases cover foreign import/row IDs, admin denial, disabled feature,
  invalid/oversized/extra-file input, missing confirmations, barcode/SKU conflicts,
  skipped unchanged rows, remaining-row idempotency, stale previews, concurrent
  corrections, revoked sessions, quotas and a 100-row commit plus retry.
- Actual Chrome browser workflow against the compiled API and real Mistral OCR:
  the owner's spreadsheet screenshot produced 9 rows, with all 81 original cells
  matching the expected values (including empty barcodes, zero stock and FALSE).
  Changed one row to a repeated-digit barcode and confirmed it was blocked;
  explicitly committed the other 8 rows, opened the one-row remainder, corrected
  it and committed only that row. One paid OCR request; zero production writes.
- Inspected Portuguese entry/preview/error/completion at 390 x 844 and preview at
  1280 x 900. English entry/completion browser checks also passed without another
  OCR request. Both browser runs recorded zero page errors. Local screenshots
  are retained at `/private/tmp/achaaqui-photo-review.oiHMhR/`.

The real browser run exposed a CommonJS image-decoder import issue that source
unit tests had missed. The import now works in both module modes; integration
tests instantiate the compiled decoder so this regression is covered. Other
follow-up fixes cover multipart part counting, the quota advisory-lock call,
skipped unchanged rows, preview pagination and actionable bilingual errors.

The earlier review's QA servers/container were removed after that run. The release
run uses another labeled disposable database, removed at release close. Neither
run uses the preserved local catalog database. Screenshots are retained.

No native-camera/device check is claimed. Before release, test on an iPhone:
camera permission denial, camera capture, Photos selection, HEIC conversion,
offline/reconnect, session expiry, both languages, long tables and blurred/skewed
photos. A successful clean screenshot is not proof of phone-photo OCR accuracy.

## Focus for Claude's review

Start with API `apps/api/src/imports/{merchant-imports.controller,
photo-import.service,photo-ocr.service}.ts`, `import-commit.service.ts`, the PHOTO
SQL migration and `apps/api/test/photo-import.integration.spec.ts`. In mobile,
read `src/app/store/import.tsx`, `src/merchant/photo-import.ts`,
`src/merchant/photo-import-copy.ts`, merchant multipart/session handling and the
image-picker configuration in `app.json`. Inspect both the checkpoint feature
and the follow-up fixes; reviewing only the latter misses the feature.

## Provider terms and pilot budget

The official [OCR 4.1 model page](https://docs.mistral.ai/models/ocr-4-1) lists
annotated OCR at USD 5 per 1,000 pages. Twenty one-page reads/day for 30 days is
approximately USD 3, excluding taxes and other services. This is an estimate,
not a billing-account spending cap.

Before real merchant data, the owner must review account training/retention
settings. [Free-mode training and opt-out](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)
and [paid-plan zero-data-retention eligibility](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention)
are separate controls. No zero-retention or no-training setting was verified for
this account. Current rollout data is owner-approved test data only.

1. Tenant scope and session rechecks for every photo route/write.
2. Commit/correction/cancel races and preview-token binding.
3. Invalid/skipped/unchanged row counts and correction-import behavior.
4. Multipart/image/provider boundaries, cost caps and credential redaction.
5. Unchanged CSV/XLSX/manual behavior and enum-compatible rollback.
6. Mobile permissions, confirmation resets, recovery after ambiguous failures,
   and UI explanations without translating merchant data.
