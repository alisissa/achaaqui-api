# Mobile merchant Excel/CSV import — review handoff

19 September 2026. Implemented and verified locally; not deployed or committed.
Mobile build 8 is signed/exported, not uploaded. No schema change, migration,
admin UI change, production write, or OCR/provider call was needed.

## Merchant experience

The merchant area adds **Import Excel / CSV**, translated into Portuguese. Choose
one `.xlsx` or UTF-8 `.csv` file from the phone's document picker, up to 2 MB and
500 rows. Existing column names and English/Portuguese aliases are supported.
SKU and barcode should be Excel Text cells; an unknown barcode can stay blank.
`.xls` and `.numbers` must first be exported to XLSX or CSV.

Upload creates staging data, not catalog products. Review errors/warnings, correct
or skip rows, then explicitly confirm valid rows. Warning acceptance and creation
of new shared products have separate unchecked acknowledgements. Invalid/skipped
rows can be resolved after a partial commit without uploading the file again.
Whole-file parser errors (for example unsupported workbook structure) require
fixing and selecting the original file again; they are not editable row previews.
Product names and merchant-entered content are not translated.

## Contract and implementation

All endpoints below are under `/v1/merchant/file-imports` and require the existing
merchant session and `MERCHANT_ACCESS_ENABLED`. They do not depend on the photo
feature flag or Mistral credentials:

- `POST /csv`, `POST /xlsx`: one multipart `file`, no merchant ID or form fields.
- `GET /`: recent imports; `GET /:id`: editable preview.
- `PATCH /:id/rows/:rowId`: correction or skip, with expected preview token.
- `POST /:id/commit`: expected preview token, explicit confirmation and applicable
  warning/new-product acknowledgements. No photo-only `reviewedPhoto` field.
- `POST /:id/cancel`: expected preview token.
- `POST /:id/remaining`: correction import for leftover rows.

`merchant-file-imports.controller.ts` is a thin guarded adapter. The existing
`ImportStagingService` and lifecycle methods in `PhotoImportService` are shared
using an explicit file/photo scope rather than duplicating the pipeline or
renaming the entire photo module. CSV/XLSX parsing limits remain unchanged.
Normalized staging JSON now preserves raw editable input and parser warnings.
Correcting another row cannot silently remove a numeric-SKU warning.

Mobile's existing photo screen moved into `src/merchant/import-screen.tsx`, with
small route wrappers for each source. The native document picker uses the same
Expo File upload transport fixed in build 7, not unsupported URI descriptors.
The picker dependency is Expo-compatible `expo-document-picker` 57.0.2. No new
image processing, AI service, database table, or background job was introduced.

## Security and correctness

- Guard runs before multipart parsing. Store identity comes only from the session.
- Source/merchant scope also requires a merchant actor for file imports. Admin
  spreadsheet imports are not exposed to merchants, even for their own store.
- Copied IDs and file/photo source mismatches return 404 on reads and mutations.
- Session validity is rechecked inside write transactions, including staging
  after parsing. Revocation during parsing cannot create a staging record.
- Preview version checks, transaction locks, idempotent commit, SKU safety,
  price history and existing row validation are preserved.
- Invalid/new-product rows never publish without the appropriate confirmation.
- Merchant responses retain no-store behavior; file-route 500 stacks are suppressed
  alongside photo routes. No credentials or customer data were logged in tests.

## Verification performed

- 131 API unit/HTTP tests passed.
- 90 integration tests across six files passed against disposable PostgreSQL 18.6,
  with existing SQL applied manually. Neither Neon nor the preserved local DB was used.
- Added coverage for CSV/XLSX preview/commit, corrections, partial commit/remainder,
  idempotency, stale previews, copied IDs, admin imports, wrong-source IDs,
  disabled photo feature, session revocation, multipart limits, and warning retention.
- API lint/typecheck/build passed. Mobile lint/typecheck and 43 tests passed.
- Web export passed with 19 routes. A real browser, local API and disposable DB
  completed both CSV and XLSX uploads through explicit confirmation and commit;
  no browser runtime errors were observed. Narrow and desktop layouts were inspected.
- Build 8 archived/exported; signatures, team, build number, native document picker,
  production API URL, disabled demo mode, and exclusion of QA code were verified.

This is not a physical-iPhone Files/iCloud picker test. Native file selection,
provider download, cancellation, correction, and interrupted-network recovery
remain release-device checks. Existing photo flows also need a quick regression
check on that same build.

## Release order and rollback

After review and explicit rollout approval: deploy API first, verify protected
file routes and old photo/admin behavior, then upload mobile build 8 to internal
TestFlight. No migration, new secret or photo flag change is necessary.

An old API has no file routes, so build 8's file feature will not work against it.
If rolling back, stop distributing build 8 first; already-installed copies still
need the compatible API. Existing one-by-one and photo workflows remain separate.
See the [build 8 artifact record](../../achaaqui-mobile/docs/testflight-build-8.md).
