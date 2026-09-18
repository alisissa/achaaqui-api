# Product reviews production rollout — 16 September 2026

Owner-approved rollout to the existing AchaAqui project `achaaqui-web`, region
`us-east4`, using named configuration `achaaqui` and personal Google account
`alisissa@gmail.com`. No Git commit/push, IAM/secret/DNS/billing/scaling change,
Firebase Hosting release, homepage change, or TestFlight upload was performed.

## Production result

| Service | Ready revision | Immutable image index digest |
| --- | --- | --- |
| API | `achaaqui-api-00008-hfh` | `sha256:cf0b50aac9296da3f1b8960b8c014255f46da56088d94288ac865e82d60eb30a` |
| Admin | `achaaqui-admin-00005-v59` | `sha256:8c3595a95669aeca27124844c1ad9b8e18f9f2dc235f28f4b44a201e7d01bc44` |

Registry prefix: `us-east4-docker.pkg.dev/achaaqui-web/achaaqui/`, images `api`
and `admin`. Both ready revisions serve 100% of traffic. Registry index and
Cloud Run linux/amd64 platform digests were independently verified. API platform
digest: `sha256:f7edd4df342b586bf03201b9713d22ecf4d9b6479779b3e4c215410227947e89`;
admin: `sha256:94ce03922644ea1dbca7db46f18c34038a9cbe481b407927416ebb9b30e1952a`.

`PRODUCT_REVIEWS_ENABLED=true`; `MERCHANT_ACCESS_ENABLED=true` remains unchanged.
Firebase-only platform admin authentication, dedicated runtime identities,
secret references, service IAM, origins, resources and scaling were preserved.
API remains min 1/max 1; admin min 0/max 1. This rollout adds no warmer instances.

The admin deployed first. API revision `achaaqui-api-00007-hv8` deployed with
reviews disabled and passed compatibility checks before the flag-only revision
`achaaqui-api-00008-hfh` enabled them.

## Backup and raw SQL migration

The owner separately approved the sensitive local backup. It is retained at
`/private/tmp/achaaqui-reviews-release.32bio6/neon-before.dump` (64,033 bytes),
mode `0600`, inside a `0700` directory. It contains test catalog and merchant
authentication records: do not publish, attach, or commit it. This temporary
location is not a durable backup system. A restore rehearsal was not performed.

Backup SHA-256:
`1a891037d5a722b381d0aa5e5d0cb61b1db0fb379f7fe9af4dc68e5137d7573d`.

Applied only `20260916160000_anonymous_product_reviews/migration.sql` as raw SQL,
using the verified direct Neon `neondb` endpoint and TLS certificate validation.
No Prisma migration command was used. SQL and its successful migration-history
record were committed in one transaction at `2026-09-16T18:37:44.125Z`.
Checksum: `2fdb002c7ad128c08804f28aaf0a680d2c877d1371ac498e14de678ea78a647c`.
Existing five migration checksums matched before application. Existing table
contents remained unchanged, and the target CHECK and unique index were valid.

## Evidence

- Fresh production dependency audits: zero known vulnerabilities in all three
  repositories. No package changes were made during rollout.
- Exact API/admin images passed disposable PostgreSQL 18.6 smoke checks:
  publication, identical retry, hash privacy, admin hiding, no-store, Google-only
  admin login, five protected redirects, 21 denied admin operations, non-root
  runtime and environment-file exclusion. Only labeled temporary containers,
  network and tmpfs data were removed; preserved local database volume unchanged.
- Seven public catalog responses matched the old production release before and
  after enabling reviews and hiding the test review. Health/readiness passed.
  Public product/merchant IDs, names, prices and response shapes were preserved.
- Production denied all 21 checked anonymous admin operations and unauthenticated
  merchant reads. Admin login and protected-page redirects passed over HTTPS.
- Live test target was the existing seeded `demo-speaker`, product
  `9bcee7fc-7a18-50c0-a75f-29274950afda`. Concurrent identical submissions created
  one published four-star review. Different duplicate returned 409; invalid
  ratings/extra fields returned 400; missing identity returned 401. A review
  token could not authorize admin moderation or merchant-session access.
- Live review `f1c7e83b-e8c5-42e8-b276-9e738a004323` was immediately hidden by an
  owner-approved SQL cleanup scoped to its new identity, product and exact test
  comment. It remains REJECTED for audit/duplicate prevention; no fake rating is
  public. Public rating returned to null/zero and retrying did not republish it.
  This cleanup is **not** proof of a positive Firebase-authenticated browser
  moderation round trip. Positive moderation HTTP was tested locally.
- Final readback at `2026-09-16T18:45:28.933Z`: nine catalog/import/history tables
  unchanged, only one new REJECTED review, migration recorded, runtime/IAM intact,
  and zero ERROR-or-higher or HTTP 5xx log entries in the checked release window.
  This is a bounded smoke check, not a load test or guarantee against future errors.

Evidence manifests/scripts/logs live in `/private/tmp/achaaqui-reviews-release.32bio6/`.
Credentials were held in memory and not printed or saved to tracked files.

## Source and native artifact

The repositories remain on `feat/mobile-merchant-access` with existing uncommitted
work preserved. Image labels identify base commits plus full non-ignored source
manifests, not new release commits:

- API base `5ca540b1186bf94876a9feff40a9e3ee06bed3e8`, fingerprint
  `9eb8307ec4d84ced92c2ba83fe44358549553e4b30fabe81449cf914cbd37fc9`.
- Admin base `85d7de6bca95574f23868c2a10d434871ca5bd92`, fingerprint
  `90f6b410e53452c3ada4a8d09e8cb3f5f3c3ff0b3f5954a8db511c8c1d88c400`.

Release documentation was updated afterward and is not inside those image
fingerprints. See [mobile build 5](../../achaaqui-mobile/docs/testflight-build-5.md):
signed, verified and exported, **not uploaded**. Physical-iPhone review identity
persistence, keyboard submission and network-failure checks remain outstanding.

## Rollback safety

Disable `PRODUCT_REVIEWS_ENABLED` on this compatible API to stop review endpoint
access, after appropriate approval. Do not roll back to the previous merchant-only
API/admin binaries: even the REJECTED test review has null merchant fields those
versions cannot safely read. The flag does not change that database shape.
Keep the compatible schema/code and roll forward. Do not restore the whole backup
or remove reviews as an automatic rollback; either could discard later writes.
