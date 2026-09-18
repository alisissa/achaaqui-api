# Mobile merchant access — test-only rollout live

The owner approved proceeding with the existing testing-only production data on
15 September 2026. The migration, API and admin rollout are complete; a reusable
login for DEMO — Loja Centro passed live authentication and isolation checks.
See the [release evidence and remaining gates](merchant-release-2026-09-15.md).

Scope: the existing mobile app gets a Portuguese left menu, “Sobre nós” and
“Promoções” coming-soon pages, username/password login and a private “Minha loja”.
Merchants can list/search their own offers, select an existing shared product or
create a product, change price/SKU/stock/availability, remove and restore offers.
Shared product names/images are not editable by merchants. Removing an offer
does not delete the product or its price history. Customers remain anonymous.

Screenshot/OCR import is not implemented. The existing admin CSV/XLSX pipeline
is unchanged; there are **no merchant import routes** in this slice. Families,
attributes, discounts and customer fuzzy search remain separate follow-ups.

## Credentials and access

- One username per store, case-insensitive ASCII, 3–40 characters. A platform
  admin provisions/resets it from Merchant → Mobile merchant access in the admin.
  No public signup, social login or public password-reset endpoint.
- Passwords: 15–128 characters; use unique password-manager-generated values.
  Node/OpenSSL's asynchronous scrypt uses a random 16-byte salt, N=131072, r=8,
  p=1 and a 64-byte derived key. Never decrypt, log or return passwords/hashes.
  Only one derivation per process runs at once to bound memory; excess work is
  rejected with 429 rather than queued indefinitely. This follows the
  [OWASP scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Sessions: random 32-byte bearer tokens, only their SHA-256 digests stored in
  PostgreSQL, absolute 12-hour expiration. One active session per store: signing
  in again ends the previous session. No refresh tokens or extra infrastructure.
- Native tokens use Expo SecureStore, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  Passwords are never persisted. Web QA uses memory only, not localStorage.
  See [Expo secure storage](https://docs.expo.dev/versions/latest/sdk/securestore/).
  Offline startup, timeouts, rate limits and service outages retain the saved
  token but grant no merchant access until `/auth/me` succeeds. The merchant
  screen offers Retry. Confirmed invalid/expired/revoked sessions are cleared.
- Authentication derives the store from the database session, never from a
  client merchant ID, claimed role, email, or public merchant contact field.
  Each write rechecks and locks the user/merchant inside its transaction.
  Disabling/resetting/logout revokes sessions under the corresponding user lock.
  Every subsequent request checks current user, merchant and session state.
  Offline logout still clears local access and private query data; the app
  explicitly reports that server revocation could not be confirmed. That token
  remains bounded by its expiry or an administrator reset/disable.
- Private responses are no-store, including auth/errors in the application
  middleware. Credentials never enter analytics, logs, URLs or public DTOs.
  Public offers retain compatibility fields `merchantSku: ""` and
  `stockQuantity: null`; public SKU search is removed. Business contact fields
  remain public directory information, separate from login credentials.
- Existing platform-admin Firebase checks are unchanged. A merchant token
  cannot invoke admin provisioning, admin imports or other admin routes.
- Login has 10 requests/minute per server-observed IP plus a durable account
  budget of 5 attempts/15 minutes. Unknown/disabled/locked accounts get the same
  generic failure and password derivation. Existing conservative proxy handling
  remains: do not trust arbitrary X-Forwarded-For headers. Shared proxy buckets
  can cause false-positive rate limits; per-process IP limits are not a global
  DDoS defense. Reassess proxy handling before changing deployment topology.
  Review finding: a known username can be targeted to repeatedly exhaust the
  account budget; this is an availability risk, not solved by obscure usernames.
  Existing sessions are not revoked by failed logins. The source and recorded
  deployment use conservative `TRUST_PROXY_HOPS=0`; a live forwarding-chain and
  abuse-control review remains required before real merchant onboarding. The
  owner approved the limited testing rollout with these restrictions unchanged.
  No production proxy setting, account limit or password-work cap was weakened
  during the four-fix regression slice. Do not describe lockout abuse as solved.

## Contracts

```
POST   /v1/merchant/auth/login       { username, password }
GET    /v1/merchant/auth/me
POST   /v1/merchant/auth/logout
GET    /v1/merchant/catalog/products?q=&page=&pageSize=
GET    /v1/merchant/offers?q=&active=&page=&pageSize=
POST   /v1/merchant/offers
GET    /v1/merchant/offers/:offerId
PATCH  /v1/merchant/offers/:offerId
DELETE /v1/merchant/offers/:offerId

GET    /v1/admin/merchants/:merchantId/login
POST   /v1/admin/merchants/:merchantId/login  { username, password }
PATCH  /v1/admin/merchants/:merchantId/login  { active }
```

The admin GET always returns JSON: `{ login: null }` before first provisioning,
otherwise `{ login: { username, active } }`. Never return bare null/empty HTTP
200. API and admin reader must be released together, API first.

Merchant offer inputs reuse the existing validated admin DTOs and transactional
services. Mobile uses an explicit review/confirm screen; warnings are initially
unchecked and shown before a second confirmation. Edits carry the original
`expectedUpdatedAt`; stale changes fail with 409. New-product creation remains
atomic. Price/currency changes record the verified merchant user as actor;
removal records `removedBy`. No automatic retries of writes after network errors.
Editing preserves visibility and the original removal actor. Restoring uses a
separate action and confirmation that the offer will become public. Mobile sends
the price as typed (including `1.299,00`); the confirmation parses only unambiguous
formats and rejects malformed/ambiguous values. Server normalization is unchanged.

## Database and release gates

New additive SQL migration `20260915090000_merchant_access` creates MerchantUser
and MerchantSession and adds nullable MerchantProduct.removedBy. It does not
alter existing product/offer IDs, enum values, prices or historical rows.
After isolated tests and explicit owner approval, it was applied to Neon on
15 September 2026. Existing catalog data checksums were unchanged. The preserved
local database was not migrated.

`MERCHANT_ACCESS_ENABLED` defaults to false; it is true in the approved test-only
Cloud Run API deployment. One demo login was provisioned. Firebase providers,
IAM, secret references and billing settings were unchanged. Production retains
the approved API minimum of 1; do not replay old min-0 templates during a release.

After owner approval, release order is reviewed SQL → API → admin → new native
build. Target remains AchaAqui's `achaaqui-web` project / `us-east4`; preserve
existing identities, scaling, budget controls, authentication and origins.
Provision the intended demo store using the admin form, sharing its unique
password privately. Do not commit demo passwords or run the general seed in
production. Enable the feature flag only for the approved rollout.

The new Expo SecureStore dependency requires native regeneration/build and a
physical iPhone check of login, secure persistence, expiry, logout, background /
foreground transitions and product changes. The owner confirmed installing build
3 and seeing the merchant menu/login. Web and live API QA do not prove Keychain
or native session behavior; those device checks remain pending.
Account lifecycle/App Review requirements must also be reviewed before public
distribution; this slice is not an App Store submission.

Rollback: disable merchant access first, then restore compatible app/admin/API
versions as approved. Leave the additive tables in place; never drop accounts
or history as part of routine rollback. Existing anonymous customers continue
to use the same catalog contracts.

## Verification

API: lint, typecheck, unit/HTTP tests, integration tests, build, compiled admin
authorization and merchant rate-limit/default-closed smoke tests. The integration
script builds first so tests use current emitted Nest metadata. New HTTP tests
require an explicit localhost TEST_DATABASE_URL whose database name includes
`test`; they must never target Neon or the preserved development data.

Mobile/admin: lint, typecheck, tests and web export / build. An isolated Chrome
journey uses generated in-memory credentials, a disposable test merchant, and
real local API writes. No production writes are used for verification. Physical
iPhone verification remains separate from the completed test-only backend rollout.

Verified locally on 15 September 2026 with Node 22.22.3 / npm 11.19.1:

- API: lint/typecheck/build; 117 unit/HTTP tests, 57 isolated PostgreSQL 18
  integration tests, 15 compiled authorization/rate-limit tests, 8 dependency
  checks and 6 deployment-configuration checks passed.
- Admin: lint/typecheck/build and 25 tests passed. Mobile: lint/typecheck,
  16 tests and a 17-route static web export passed.
- The phone-width browser journey covered menu, login, own-store listing,
  price edit, new-product creation, warning confirmation, removal and logout.
  First-time admin provisioning (starting with no login) and password reset were
  exercised at desktop and phone widths. Mobile browser checks also covered
  ambiguous-price rejection, the raw Brazilian-price request, editing while
  hidden and explicit restoration. No
  browser runtime errors were observed. All merchant fixtures were temporary.
- The actual session provider passed a browser harness with mocked native
  storage/transport: offline retention, no unverified private requests, retry,
  invalid-session clearing and logout. Real iPhone/Keychain checks remain pending.
- A read-only cross-repository comparison matched mobile confirmation parsing
  to API normalization for 306 representative price strings.
- Production-only npm audits reported zero known vulnerabilities in all three
  repositories. This is not a guarantee against undiscovered vulnerabilities.
