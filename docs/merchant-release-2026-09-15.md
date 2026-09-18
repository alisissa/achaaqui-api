# Merchant access — test-only release, 15 September 2026

The owner confirmed all current production data is testing data and explicitly
authorized proceeding after the local-backup permission question. This completes
the backend/admin release for installed internal TestFlight 0.1.0 (3). It is not
a public App Store launch or approval for unrelated infrastructure changes.

## Deployed and verified

Project `achaaqui-web`, region `us-east4`, operator `alisissa@gmail.com` using the
named `achaaqui` gcloud configuration. API was deployed before admin.

| Service | Ready revision | Registry image index digest |
| --- | --- | --- |
| API | `achaaqui-api-00006-86x` | `sha256:404057d4624a6cc8bd50a01f86a4b8c7f8b8002ef3053a6775ebe96eced5442f` |
| Admin | `achaaqui-admin-00004-bn4` | `sha256:1efe058d38c8ef25f086c87ccd545fb1acc3a35e61109affceb7b325b999c7f4` |

Both have 100% latest-revision traffic and verified immutable amd64 manifests.
The images contain the separately reviewed feature-branch working trees, not new
Git commits. Source fingerprints are
`ec6023771587a2324916f470626dc219211f8a658ddf066197f9f7fa5f2a834d` (API) and
`2ab5840dfead3a1c9b0a194d602d15dea79214846fc1275d5d733e2433f0d0a4` (admin).
Subsequent documentation-only updates describe this completed rollout.

Only image references and API `MERCHANT_ACCESS_ENABLED=true` changed. API service
min 1/max 1, admin min 0/max 1, revision min 0/max 1, request-based 1 CPU/512 MiB,
concurrency 4, 60-second timeout, runtime identities, Firebase admin authentication,
origins, secret references and service IAM were preserved. No DNS, Hosting, IAM,
secret, billing-plan or budget changes occurred. The EUR 20 alert budget was
read back; it is not a hard spending limit.

## Data and demo account

An owner-approved, TLS-verified custom-format Neon backup was saved locally with
0600 permissions in `/private/tmp/achaaqui-merchant-release.g3HBc2/neon-before.dump`.
It is 58,825 bytes, SHA-256
`8a63a0256c3b3f0296346dca9bafd7ff8c767a272e3338a2d5993c0f7f76d0c7`.
This local temporary-path backup is not durable off-machine disaster recovery;
no restore drill was performed in this release.

Applied only `20260915090000_merchant_access`, checksum
`eda7294a48e22236cee68077bd988ae9fbffeca7156739cf4c477e2d236c9b75`.
All five migration records are successful. Counts and canonical row checksums
for nine existing catalog/import tables stayed identical; the new nullable
`removedBy` column was excluded from the old-data checksum comparison. No reset,
general seed, product deletion or preserved-local-database change occurred.

Created one reusable login for existing **DEMO — Loja Centro**, which has 12
offers. No other merchant login was created or reset. Provisioning used an
owner-authorized local administrative task with the reviewed PasswordService,
the shared merchant-login advisory lock and an insert-only transaction. The
recorded actor is `release:alisissa@gmail.com`; this was not an authenticated
browser form submission. The account remains until reset or disabled; sessions
expire after 12 hours and a second login revokes the previous device's session.
Credentials were handed off through an owner-only local file, never source,
environment configuration or logs. Changes to this demo store are public.

Subsequent owner-requested test exception: the same demo account was renamed and
reset to the owner's easy demonstration credentials. This intentionally weak
credential pair must be replaced before real merchant use; anyone who knows it
can modify the demo store. The reset was scoped to this existing account and
revoked its previous session. Passwords still use salted scrypt; normal admin
provisioning still requires 15–128 characters. No validation, auth code or cloud
configuration was changed to make this single test-data exception.

## Verification

The exact images reused the completed local suite: API 117 unit/HTTP tests,
57 isolated PostgreSQL integration tests, 15 compiled authorization/rate tests,
8 dependency checks, 6 deployment checks; admin 25 tests; mobile 16 tests and
17-route export. Lint, typechecks and builds passed in all affected repositories.
These suites were not run against production. Exact-image local smoke tests and
source fingerprints were checked before deployment.

New live checks passed:

- 20 API checks: public catalog/readiness, unauthenticated denial, successful
  demo login, 12 own offers, copied other-store offer denied, admin routes denied,
  client-supplied merchant selector rejected, catalog lookup, public stock/SKU
  hidden, private no-store headers, logout and rejection of the revoked token.
- Admin Google-only login, 11 asset fetches, six protected-page redirects
  including merchant-access management, invalid-session rejection and original
  brand-image bytes. This is HTTP verification, not a new production browser or
  physical iPhone walkthrough.
- Registry digests, ready revisions, traffic, unchanged runtime limits and IAM.

Live verification did not modify catalog products or offers. Its session was
revoked, leaving the demo login ready for the owner. No Git commit, merge, GitHub
push, new TestFlight build or public app submission occurred in this continuation.

## Remaining before real merchant onboarding

The known username-lockout availability risk, shared proxy rate-limit buckets and
one-concurrent-password-derivation restriction remain; no rate limit, password
hash or proxy trust was weakened. The owner approved this testing-only rollout,
not a claim that those limitations are fixed. Revisit these controls before real
merchants. Also retain the documented restricted runtime database-role and
backup/recovery follow-ups, actual iPhone/Keychain session tests, and account
lifecycle/App Review assessment before public distribution.

Rollback, only if needed and approved: disable merchant access, restore the
compatible admin then API revision, and leave the additive schema and history.
Previous revisions: admin `achaaqui-admin-00003-rpj`, API `achaaqui-api-00005-6bm`.
Before/after configuration and immutable images are recorded in the restricted
release directory above. Preserve API min 1; do not apply a historical template.
