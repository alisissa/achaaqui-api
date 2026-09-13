# Admin/API safety: step 1

Local implementation and verification, 13 September 2026. Not committed,
pushed, or deployed. No new dependencies, schema changes, merchant login,
catalog matching features, discounts, or public response changes.

## Fixes

- A barcode match to an existing listing under a different merchant SKU now
  blocks the row. This includes removed listings and otherwise unchanged rows.
  The operator must use the existing SKU or explicitly edit the listing first.
- Commit rechecks the listing's SKU as well as its identity, version, price,
  and currency. Previously staged unsafe previews are rejected without writes.
  The SQL upsert no longer updates an existing listing's SKU at all.
- PostgreSQL uniqueness failures from the raw upsert are translated to a safe
  HTTP 409 conflict, including Prisma 7/adapter-pg's P2010 nested error shape.
  SQL, constraint names, and row values are not included in the response.
  Other database errors retain their existing handling.
- Authenticated API responses explicitly set `Cache-Control: private, no-store`
  in the application, not only in Firebase Hosting configuration.
- New conflict messages and the existing stale-preview message have Brazilian
  Portuguese translations in the admin. No layout/design changes.

## Verification

Used Node 22.22.3 and npm 11.19.1 from existing local caches; global tools and
dependency versions were not changed.

- Before the fix, seven new integration cases failed and the existing 21 passed:
  four CSV/XLSX rename cases, two unsafe existing previews, and the real raw-SQL
  SKU collision. The collision reproduced Prisma P2010 / PostgreSQL 23505.
- After the fix, all 29 integration tests passed. The additional eighth case
  runs two imports concurrently for different products using the same SKU:
  exactly one commits, one receives 409, and only one history entry is written.
- API: lint, typecheck, build, and all 109 unit/HTTP tests passed.
- Compiled startup/auth tests: 14 passed, including 231 rejected HTTP requests
  (11 identity scenarios across all 21 administrative operations), two approved
  private/no-store reads, and anonymous health access. The test derives routes
  from the compiled app's OpenAPI document and is included in the existing CI
  startup-test command.
- Offline dependency/deployment/Hosting checks: 17 passed. Historical private
  deployment-template assertions are template checks, not current cloud state.
- Admin: lint, typecheck, build, and all 23 tests passed.

Database tests used newly created PostgreSQL 18.6 containers, random
localhost-only ports, random test-only credentials, and tmpfs storage. Only the
four existing migrations were applied to those fresh disposable databases.
Every labeled test container and its tmpfs data was removed after its run.
The preserved AchaAqui volume and other local databases were not mounted or used.

The compiled HTTP tests execute actual Nest guards, verifier policy and routes,
but stub Firebase SDK responses and database access. They prove the current
admin-only boundary, not future merchant tenant isolation or live Firebase
configuration. Rate limiting is bypassed only in that harness so it cannot mask
authorization failures as HTTP 429. Existing upload-limit tests run separately.

## Admin source review

Catalog reads, merchant creation, offer save/removal, import upload/detail/
commit/cancel/template downloads, and review moderation use the server-only API
client. Its request helper calls `adminApiAuthorization`, which verifies the
session and current admin role before fetch, uses `cache: no-store`, rejects
redirects, and independently forwards credentials to the protected API.
The page/proxy redirect is not relied on as authorization.

Google login requires an exact allowed origin, a recent verified Google token,
current platform-admin privileges, and an enabled user. Production rejects the
local shared-password fallback. Existing policy tests cover revoked/disabled
users, stale role claims, redirect validation, and rejected origins.

Read the bundled Next.js data-security guide for this review. No change to
authentication policy or Server Action implementation was needed. This was
source/policy-test verification, not a new signed-in production/browser audit.

## Public data boundary: owner decision still pending

Intentionally public catalog data currently includes product descriptions,
barcodes, prices, availability, ratings, merchant names and published history.
The current public DTOs also expose:

- Merchant business address, phone, email and website on merchant detail.
- Merchant SKU and exact stock quantities on offer responses.
- Historical prices for removed listings; inactive-merchant visibility varies
  with the history query's merchant filter. This is an existing publication-policy
  question, not evidence of administrative write access.

Private administrative data includes raw import rows/files, validation details,
import management, account permissions, moderation controls and analytics.
Public history selects price/source/date/merchant fields, not actor IDs or
import references. Merchant login accounts do not exist yet; their login email
must not reuse the public business-contact field when introduced.

No public fields were removed or reclassified here. The owner was asked whether
exact stock should become private while availability and deliberately published
business contacts remain public. Any approved change must preserve the installed
client's contract, for example retaining a nullable stock field rather than
silently removing it.

## Later work, not included

- Merchant access requires verified account-to-store assignment and scoped
  queries for every read/write/import operation, with commit-time authorization.
  Rejecting all merchant tokens today is not proof of future tenant isolation.
- Editable import matching decisions must be saved and confirmation tied to the
  exact preview revision; changed decisions must invalidate confirmation.
- Discount effective prices must drive database sorting, cheapest-offer
  aggregation and filtering, not only the final displayed amount.
- Families, JSONB attributes, product creation by import, discounts, customer
  fuzzy search, and mobile merchant screens remain separate steps.

No production, Firebase, GCP, Neon, DNS or billing checks/changes were performed.
These bounded checks do not constitute a guarantee of zero vulnerabilities.
