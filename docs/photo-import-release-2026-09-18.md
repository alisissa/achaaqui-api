# Photo import release — 18–19 September 2026

## Current state

Reviewed fixes are committed, merged into `main`, pushed, and deployed to the
existing API/admin services. Photo access is **enabled** as of 19 September:
`PHOTO_IMPORT_ENABLED=true`, revision `achaaqui-api-00010-9sl`, 100% traffic.
After explicit owner approval, the replacement key from the ignored
`apps/api/.env.mistral-test` was transferred to Secret Manager
`achaaqui-api-mistral-key` in `achaaqui-web`, with replica in `us-east4` and
enabled version **1** pinned in the API runtime. Its only explicit IAM binding is
secretAccessor for `achaaqui-api@achaaqui-web.iam.gserviceaccount.com`; inherited
project Owner privileges still apply. No project-wide grant or key output.

The owner confirmed replacing/revoking the previously exposed key. The replacement
was verified by one successful production OCR request; revocation of the old key
was not independently tested.

Signed internal-only native build **0.1.0 (6)** is prepared, not uploaded; see
[the build record](../../achaaqui-mobile/docs/testflight-build-6.md).

## Source and fixes

Released code commits, all merged and pushed to `main`:

- API: `a4ab92b72dec892d50de497c9f98acb39af4dd16`.
- Admin: `5d8f9094fb66f6b4420f1d99c5d37ecc49f61bbc`.
- Mobile: `914dcb20b0a6b756bdecc5886fed0019e240d819`.

Later documentation-only commits do not change these image source revisions.
All three code-commit GitHub CI runs passed. Source snapshots and credential
checks passed; only the existing loopback database example was excepted from
the actual-secret-value scan. No environment files or credentials were committed.

The small fixes address cancelled-remainder retries, separate warning confirmation,
all-page preview review, white-background PNG conversion, reader-busy messaging,
and lazy recovery of interrupted reads. The global pilot quota is 20/day, not 200.
Merchants retain the approved ability to create shared products immediately, only
after explicit preview/new-product confirmation. No review queue was added.
See [the implementation handoff](photo-import-review-2026-09-18.md).

## Database

Applied only `20260918100000_photo_imports` to the verified direct Neon `neondb`
endpoint using certificate-verified TLS and raw SQL. No Prisma migration command.
Each IF NOT EXISTS enum addition ran separately in autocommit mode. Added PHOTO
to ImportSource and PriceChangeSource, then recorded the migration checksum and
successful history. All six earlier migration checksums matched before execution.

Checksum: `1669b3decfa87e91fe06ce011c852fc371f93b8b28e88a34eeabe7890562dab7`.
Completed at `2026-09-18T16:41:02.397Z`. Pre/post table counts and content checksums
were unchanged for catalog, offers, history, reviews, imports and merchant users.
No seed, product edit, authentication reset, full database export or catalog
commit was performed. This was not a backup/restore test.

## Production artifacts

Project `achaaqui-web`, region `us-east4`, existing services:

| Service | Ready revision | Immutable image index digest |
| --- | --- | --- |
| API | `achaaqui-api-00010-9sl` | `sha256:49bdc2ec2426e412ae615a59f2a67cc465d7b1ca87ec2e80c8b4b4eab9c01d3c` |
| Admin | `achaaqui-admin-00006-pdc` | `sha256:60bbd15305348ea593a7ce7b45e414016ddf2a6e38251be660de4273d46055d4` |

Registry: `us-east4-docker.pkg.dev/achaaqui-web/achaaqui/{api,admin}`.
Linux/amd64 manifests resolved by Cloud Run:

- API: `sha256:c9d468e93a83d8b16b75ffe1e22628ed9b0b1278560bd123231501617225ac3a`.
- Admin: `sha256:9064848ffc3de8a7e9abb2b9349841258c2780ae07ee3ac1412d4390d1849b6b`.

Both revisions ready with 100% latest traffic. The initial 18 September rollout
used API revision `achaaqui-api-00009-2wx` with photo access off. On 19 September,
an etag-protected update changed only the photo flag and pinned Mistral secret
reference, preserving the exact reviewed image and all other settings.
Runtime identities, Firebase
authentication, existing secrets, service IAM, origins, resources, concurrency,
timeouts and scaling were read back against preflight and preserved. API service
min 1/max 1; admin min 0/max 1. No Hosting, DNS, billing or project-IAM changes.
The new secret-level binding above is the only new IAM grant.
The EUR 20 alert budget was rechecked; it is not a hard all-service spending limit.

## Verification

- API: 131 unit tests, 84 isolated PostgreSQL 18.6 integration tests, lint,
  typecheck/build, 8 dependency and 6 deployment-template checks.
- Mobile: 35 tests, lint/typecheck and 18-route web export.
- Admin: 25 tests, lint/typecheck/build. All three fresh npm audits had no known
  advisories. These checks do not prove absence of all vulnerabilities.
- Exact final Alpine images passed real sharp 0.35.4 decoding/white transparency,
  non-root/env-file exclusion, public reads, 21 denied admin operations, merchant
  photo scope and protected admin redirects against the disposable database.
- Browser fixture confirmed the two-page and separate-warning gates; 11-row
  commit, zero provider calls and no browser errors. Both layouts inspected.
- Live custom API and direct Cloud Run URLs passed health/readiness/categories/
  products/merchants. Product detail/history/reviews and merchant detail/offers
  passed; 21 missing-auth admin operations and 3 photo operations returned 401;
  eight protected admin pages redirected to login across both admin domains.
- Both live services retained their verified images/settings. The fully paginated
  log query for the new revisions from `2026-09-18T16:37:55.091Z` found no ERROR+
  or HTTP 5xx entries at check time. Log ingestion can lag.

The initial disabled rollout made no authenticated merchant writes. The enabled
rollout on 19 September used the existing demo login and approved nine-row
spreadsheet screenshot for **one** live photo preview (11.848 seconds). All
81 cells matched, including blank barcodes, zero stock and FALSE availability.
The preview `de7dc5ae-6894-496b-b1f2-c296cb6766ff` was cancelled and its CANCELLED
status read back; no commit endpoint was called. This audit record remains in
import history. Catalog/offer/history/review table counts and content checksums
were unchanged. The temporary test session was logged out; login may invalidate
the demo user's earlier device session. Missing authentication and merchant-token
admin access returned 401; nonexistent import IDs returned 404; own-import
responses retained private/no-store headers.

Enablement readback completed at `2026-09-19T06:23:02.278Z`. Detailed evidence is
in `secret.json`, `enabled.json`, `live-photo.json` and `enable-final.json` under
the local evidence directory below. No physical iPhone camera test or production
photo commit is claimed. Screenshot accuracy is not phone-photo accuracy evidence.

Local QA servers were stopped; only the labeled release tmpfs database container
was removed and its fixtures discarded. The preserved local catalog Docker volume
metadata was unchanged. Logs, verifiers and screenshots are retained in the
owner-only `/private/tmp/achaaqui-photo-release.ZhhOLk/` directory.

## Remaining native verification

Secret storage, runtime enablement and the preview/cancellation check are complete.
Upload build 6 when directed, verify Apple processing/group availability and run
the physical-device checks in its build record. No new binary was needed for
this server-only enablement, and no Apple upload was performed.

Account training/retention settings remain owner-unverified; use approved testing
data only until reviewed. The handoff links the official terms and budget estimate.

Rollback: this API image is PHOTO-enum-compatible. After any PHOTO records exist,
turn access off or roll forward with a compatible image. Do not roll back to a
pre-PHOTO Prisma client merely because the enum additions are additive. Do not
delete photo records or remove enum values as a routine rollback.
