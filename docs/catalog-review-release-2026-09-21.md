# Catalog and review safeguards release — 21 September 2026

Owner approved commit, merge, push, API/admin production deployment and a new
internal TestFlight upload. This is not a public App Store submission or a claim
that all public-launch policy and device-testing gates are complete.

## Released scope

- Merchant CSV/XLSX selection uses the existing preview, correction/skip,
  explicit confirmation and transactional/idempotent commit flow; no OCR charge.
- Sale prices and message promotions, effective-price sorting, homepage-only
  sponsored offers/stores, PostgreSQL trigram fuzzy search, static About Us.
- Review reporting, personal reviewer blocking/clear blocks, admin report queue,
  simple PT/EN comment filter and confirmed admin reviewer bans/unbans.
- Filter correction stops profanity matching across separate words. Dotted and
  digit substitutions remain checked; fully spaced letters are not joined.
- Mobile pagination, analytics-storage/catalog loading and availability-badge fixes.

Original handoffs remain historical implementation records:
[commercial discovery](commercial-discovery-local.md),
[file imports](merchant-file-imports.md), [review safety](review-safety-local.md).
Their earlier local-only status is superseded by this release record.

## Source and immutable artifacts

All three release branches were fast-forward merged and pushed to `main`.

| Component | Runtime source commit | Ready revision / build |
| --- | --- | --- |
| API | `6b52d541103d842f882dc2f23bc8fd690d6e8532` | `achaaqui-api-00011-797` |
| Admin | `1414d69703fdbca7af3f9bc7279c7677d1e73f90` | `achaaqui-admin-00007-4ns` |
| Mobile | `7c19eee225699b059e4c8869ba78ba69ddd85060` | `0.1.0 (9)` |

API runtime source is identical to feature commit `7b6db5d` except for a test-only
correction from 21 to 27 documented admin routes in compiled authorization tests.
The stale count stopped the first CI run; the corrected commit passed full CI.
Admin and mobile release commits passed CI too. Later documentation commits do
not alter the released binaries.

Registry prefix: `us-east4-docker.pkg.dev/achaaqui-web/achaaqui/`.

- API index: `api@sha256:696031b6020c554bae584927cd5115d4e8fc097261a6757a65d33d1635ba0259`.
  Linux/amd64 manifest: `sha256:7b40ffdae0fdb5ff51aeab7b1c4b12d06a4a43d1acde728670077155f374033c`.
- Admin index: `admin@sha256:9931cc4a387b5a18adde348604c6dbb25c68f00ff366602a096377b6b7544969`.
  Linux/amd64 manifest: `sha256:0d418997cb1af4fee54df43302cab24b626816636fbc520f8b43be41c7e38635`.

Registry digest readback matched the local images; Cloud Run resolved the expected
platform manifests. API ready at 09:18:38 UTC; admin ready at 09:19:31 UTC.
Both have 100% latest-revision traffic. Image-only, etag-protected service updates
preserved identities, IAM, environment/secret references, probes, resources and
scaling. API remains min 1/max 1; admin min 0/max 1. No DNS, Hosting, billing, IAM,
new secret, homepage or global cloud-configuration changes were made.

## Database

Before migration, verified all seven existing migration checksums and created a
full custom-format `pg_dump` with strict TLS and owner-only permissions. Retained
locally outside source control at
`/private/tmp/achaaqui-release-20260921.oYmbWv/neon-before-verified.dump`.
It contains authentication records: do not share or commit it. Size 69,330 bytes;
SHA-256 `9c17b0f20da1d7763a0b1e19ff964cb409965b062f47a9c9c19eecc8b656e112`.
Archive directory readability was verified with `pg_restore --list`; an actual
restore drill was not performed. Temporary-directory storage is not durable backup.

Applied reviewed raw SQL in one transaction, with bounded lock/statement timeouts,
and recorded matching migration checksums (no Prisma migration CLI):

1. `20260919130000_commercial_search`
2. `20260920180000_review_safety`
3. `20260921090000_reviewer_bans`

Completed 09:12:14 UTC. Counts and checksums over every pre-existing field in the
11 catalog/import/merchant-auth tables were unchanged. Product search text was
backfilled. No sample products, discounts, sponsors, reviews or merchant logins
were created, edited or removed for the production smoke checks.

## Verification

- API: 164 unit tests; 114 integration tests on a fresh disposable PostgreSQL 18
  database; 8 dependency and 6 deployment tests; lint/typecheck/build; zero known
  production npm audit findings. All 15 compiled startup/auth tests passed,
  including 27 documented plus 3 credential-management operations across 11
  unauthorized identity scenarios, and approved private/no-store reads.
- Admin: 28 tests, lint/typecheck/build and production dependency audit passed.
- Mobile: 56 tests, lint/typecheck and 20-route web export; dependency audit passed.
- Exact packaged services: public reads, all 27 documented admin operations
  denied without authentication, merchant import/commercial denial, admin login
  redirects, non-root processes and no copied environment files. Linux/amd64
  sharp 0.35.4 decoded/flattened a transparent PNG successfully. No paid OCR call.
- 51 live checks passed after deployment: catalog/category/product/merchant,
  price history/reviews, commercial/search reads, unauthorized protected requests
  and admin login/redirects. Public SKU and exact stock remain blank/null.
- Completed log query at 09:21:02 UTC found no ERROR-or-higher or HTTP 5xx entries
  for the two new revisions since 09:17 UTC. This is a bounded rollout window,
  not a future reliability guarantee.
- Native archive/export/signatures and production configuration verified;
  Apple accepted build 9. See [the native record](../../achaaqui-mobile/docs/testflight-build-9.md).

Earlier browser QA covered PT/EN narrow/desktop review flows against an isolated
database. This release did not repeat authenticated production mutations or
physical-iPhone/Android runtime QA. Integration fixtures never used Neon or the
preserved local database volume. Existing local QA databases/services were kept.

## Rollback and remaining gates

Previous images, for a separately considered rollback:

- API: `api@sha256:49bdc2ec2426e412ae615a59f2a67cc465d7b1ca87ec2e80c8b4b4eab9c01d3c`.
- Admin: `admin@sha256:60bbd15305348ea593a7ce7b45e414016ddf2a6e38251be660de4273d46055d4`.

Disable `PRODUCT_REVIEWS_ENABLED` **before** reverting to an API without ban
enforcement. Keep submissions disabled until enforcement returns. Revert admin
before an incompatible API; old mobile builds lack the new controls. Keep all
additive tables and recorded data; do not restore the dump over new writes or
drop moderation records as a routine rollback. Old pre-product-review binaries
have additional nullable-listing incompatibilities.

Anonymous identity resets can bypass one-review limits and bans; no physical
device guarantee is claimed. The small comment filter is not comprehensive abuse
moderation. Broader merchant-content moderation, operating the report queue,
retention/deletion decisions, policy/provider disclosures and final App Store
requirements remain public-launch work. Native Files/iCloud/camera/network-failure
and review-safety checks remain required on the uploaded build. Upload acceptance
does not establish tester availability or App Review approval.
