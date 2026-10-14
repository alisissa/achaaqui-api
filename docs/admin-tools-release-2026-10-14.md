# Admin catalog tools release — 14 October 2026

Owner approved production deployment ("go to prod"). Project `achaaqui-web`,
region `us-east4`, configuration `achaaqui`, account `alisissa@gmail.com`.
Image-only updates; runtime configuration, secrets, scaling and IAM unchanged.

| Service | Previous (rollback) revision | New revision (100% traffic) |
| --- | --- | --- |
| API | achaaqui-api-00015-2b6 | achaaqui-api-00016-fcs |
| Admin | achaaqui-admin-00009-pbr | achaaqui-admin-00010-9fx |

Tag `admin-tools-20261014`.
API: `api@sha256:0a32d56ae035db5ca7a104df9b88d20a410a28206dd79174fcd623a021a2feb1`.
Admin: `admin@sha256:70c0e1977aeffa9973afe5e87d141ce4cb2041fc0ec855286e292d28f8014e5e`.

## Source

Like the 7 and 8 October releases, built from local uncommitted source, not
from main: production already ran uncommitted work (catalog photos, price on
request, review catalog). Every API file changed after the 8 October deploy is
part of this slice. The admin image was built from a scratch copy of the admin
tree plus this slice; the admin working tree itself was not modified.

## Changes

- Admin product list `GET /v1/admin/products`: search (name, brand, model, SKU,
  barcode), filters (category, merchant, status), sort (newest, oldest, price
  ascending/descending, name). Includes inactive products. No search analytics.
- Merchant soft delete `DELETE /v1/admin/merchants/:id` `{confirmed: true}`:
  sets inactive, unsponsored, `deletedAt`/`deletedBy`, ends merchant sessions,
  keeps all offers and history. Only actors in `MERCHANT_DELETE_ACTOR_IDS`
  (default: the owner's Firebase UID). Admin list hides deleted merchants.
- Admin photo import `POST /v1/admin/imports/photo` (multipart `merchantId`,
  `file`): same OCR, quotas and preview as the merchant app; the store must be
  active and not deleted. Commit is the normal admin import review.
- Admin: Products page, owner-only Delete on merchants, photo option in the
  import picker (browser shrinks photos to 2600 px JPEG), simpler imports page,
  Brazil-only merchant form with +55 / DDD / number phone, compact checkboxes,
  inset dropdown arrows, photo permission checkbox removed from the catalog
  photo editor. Server action body limit raised to 6 MB for photos.

## Database

`20261014120000_merchant_soft_delete/migration.sql` (two nullable columns on
`Merchant`) was applied to production as raw SQL earlier on 14 October, before
this API, and read back. Rolling back to revision 00015 is safe with the extra
columns; soft-deleted merchants stay inactive under the old code.

## Verification

- API: lint, typecheck, 181 unit tests, 137 integration tests (disposable
  PostgreSQL 18.6), 31 deployment tests including all 33 admin routes denying
  unauthorized identities, build.
- Admin release copy: typecheck, lint, 32 tests, build.
- Images: new code present, no env files, non-root users.
- Live: API health 200, public products 200, new admin route 401 without login;
  admin login 200, protected pages redirect to login. No ERROR or 5xx entries on
  either new revision in the first check.

Not verified: a signed-in production photo read, delete and product filtering
by the owner. Production currently has no active priced offers, so price sort
has nothing to order yet.
