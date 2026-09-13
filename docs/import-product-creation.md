# New-product imports

This extends the existing platform-admin import only. Merchant login and public
API contracts are unchanged. The verification below records pre-release checks;
production status must be verified against the deployed image revision.
No dependency, Prisma schema, migration, cloud, or production-data change.

## Behavior

- Upload remains staging-only. Match this merchant's SKU first, then exact barcode.
- If neither matches, a valid row with a name and brand proposes `NEW_PRODUCT`.
  The preview shows brand, model, category and the separate new-product count.
- The product is an exact sellable variant. Names never silently match or merge.
  A same-name/brand/model collision is blocked for explicit catalog selection via
  Add product or an existing barcode, not guessed. More advanced matching and
  per-row selection are separate work, not included here.
- `category`/`categoria` is optional. Supply an existing active category name or
  leave blank for Uncategorized with a warning. Unknown/inactive/ambiguous
  references fail closed. Brands are reused by canonical slug or case-insensitive
  name, consistently in preview, commit and manual add. For example, Coca-Cola
  and Coca Cola resolve to the same brand. Multiple matching brands or an inactive
  match block creation. Model comparisons are case-insensitive. Shared product
  details are never overwritten by imports.
- Blank barcodes are supported with a review warning. For new products, a supplied
  barcode must normalize to 8, 12, 13 or 14 digits, not all the same digit. This
  rule runs in preview, commit and manual creation. It is a format/placeholder
  check, **not** GS1 check-digit or ownership verification. Existing catalog
  identifiers are not rewritten or retroactively rejected when maintaining their
  listings. Reused barcodes for different rows remain errors. Never invent values.
- Uncategorized remains an ordinary public category, not a hidden review queue.
- Invalid rows are excluded; valid rows can commit after required acknowledgements.
  Removed listings stay removed. SKU conflicts retain the step-1 protections.
- CSV and XLSX templates add category at the end, preserving existing column
  positions. Both old nine-column uploads and new ten-column exports are supported.
  Unknown columns are not converted into product attributes.

## Confirmation and transactions

The protected detail response adds `previewToken`, a checksum of all stored row
decisions, values, validation, statuses and versions. The admin returns it as
`expectedPreviewToken` along with `confirmNewProducts: true` from a separate,
initially unchecked checkbox. It is not an authentication credential. Existing
warning acknowledgement remains separate and required when relevant.

New-product imports require both fields. Older clients cannot accidentally create
products. Existing-product-only imports retain compatibility, while the updated
admin always submits the checksum. Import rows are not editable in this slice.

Commit rechecks the snapshot inside the claimed import transaction. New products,
brands, fallback category, merchant listings, initial price history and row results
are written in that same transaction. Conflicts roll everything back. Repeat
commit is idempotent. Cancel creates no catalog records.

New catalog creation takes one transaction-scoped advisory lock shared with manual
creation, before listing locks. This serializes the rare catalog-create path;
ordinary price updates keep their existing listing locks. Products are inserted
in a batch and brand/category lookups are reused within the import. The import
transaction has an explicit 30-second timeout rather than Prisma's 5-second
default; failure still rolls back atomically. This is not
fuzzy deduplication or an assurance that differently described unbarcoded products
are distinct; the operator must review them.

## Scope and release

Families/JSONB attributes, fuzzy search, discounts, merchant access and mobile
remain separate slices. No approval queue, scheduler or new infrastructure.
Release requires explicit approval for both API and admin. Existing staged invalid
imports must be uploaded again to use the new behavior.

Deploy **API first, then admin**. The new admin always sends `confirmNewProducts`
and `expectedPreviewToken`; the old API's strict DTO validation rejects those
fields, including on existing-product-only imports. After the API rollout, verify
both the old admin's existing-product commits and the new import contract before
rolling out the admin. For rollback, restore **admin first, then API**. A new-product
preview is not supported by the old pair; do not attempt to commit it there.
Deployment and rollback are separate, explicitly approved release operations.

## Verification

Using Node 22.22.3/npm 11.19.1, with no dependency installation:

- API lint, typecheck, build and 109 unit/HTTP tests passed.
- 49 integration tests passed on disposable PostgreSQL 18.6, including the
  original 29 and 20 new-product cases. The optional owner-workbook regression is
  one of those 20; CI without that private local file runs 48 integration tests.
  CI sets both database variables to its disposable PostgreSQL service so the
  new-product suite runs there rather than being skipped.
- Coverage includes CSV/XLSX creation, no catalog writes before confirmation,
  cancellation, idempotency, unchanged reimport, initial history, missing brands,
  duplicate barcodes, existing-name collisions, inactive products, unknown
  categories, a changed preview with an unchanged timestamp, SKU-collision
  rollback, concurrent manual/import creation, and a 500-product/500-distinct-brand
  commit. Regression cases cover slug aliases, inactive/ambiguous brands,
  case-insensitive models, malformed/repeated-digit barcodes and older unsafe
  previews. The many-brand test is local, not a Neon latency benchmark.
- The unmodified owner workbook `test.xlsx` now has nine blocked rows because its
  textual placeholder barcodes fail the new rule. Clearing only its barcode cells
  in an in-memory test copy produced nine new-product proposals and zero invalid
  rows. Numeric SKU and missing-category warnings remain explicit. Both previews
  were cancelled in the disposable database. The actual file was not edited,
  uploaded to production or copied into source control.
- Compiled-module startup/auth checks passed (14 tests), including 231 denied
  requests across all 21 administrative operations. Real guards/current-user
  policy ran with a mocked Firebase SDK, not live Google credentials.
- Admin lint, typecheck, build and 24 tests passed, including Portuguese messages
  for the new barcode/brand errors. The preceding implementation's fixture-only browser
  checks covered desktop/narrow preview layouts, Portuguese/English, unchecked
  acknowledgements, and a Server Action submitting both acknowledgements plus
  the exact preview token. No browser exceptions or page-level horizontal overflow.
  The wide inspection table retains its own horizontal scrolling on narrow screens.
- Only the labeled test database containers and their tmpfs data were discarded.
  Browser fixture processes were stopped. The preserved local database volume,
  Neon, production services, mobile and homepage were not changed.

These are local service and fixture-browser checks, not a live Firebase-authenticated
production import, cross-cloud load test, or new dependency/security vulnerability
scan. Publishing source alone does not deploy the API or admin.
