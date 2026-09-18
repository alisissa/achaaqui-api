# Claude review handoff — product reviews and search cleanup

Date: 16 September 2026. Workspace: `/Users/aliissa/Documents/Projects/AchaAqui`.

## Request to Claude

Review only. Read the applicable AGENTS.md files and repository READMEs first.
Inspect the actual implementation; do not assume this handoff proves correctness.
Do not edit files, commit, push, deploy, enable flags, contact production databases,
run seeds, or apply migrations. If rerunning integration tests, use a new disposable
database with both database environment variables pointing only to that database
and dotenv loading disabled. Never use Neon or the preserved local volume.

Please return:

1. Concrete rollout blockers/security findings first, with file/line and a
   reproducible scenario. Distinguish verified failures from hypothetical risks.
2. Any small, necessary fixes; do not propose a redesign or extra infrastructure.
3. Remaining release checks and a concise verdict.

Explicitly scrutinize duplicate prevention/concurrency, moderation authorization,
credential privacy, hidden-review aggregates, old-client compatibility, and the
migration/deployment/rollback sequence. The accepted anonymous-identity limitation
below is not a requirement to implement customer login or device attestation.

## Product context and owner decisions

AchaAqui is an anonymous product/store comparison catalog, not checkout. The
existing stack is NestJS 11/Prisma 7/PostgreSQL, Next.js 16 admin, and Expo 57 mobile.
Products are shared sellable variants; merchants have their own offers/prices.
Merchant login and the English/Portuguese app interface were implemented earlier.

This slice was explicitly requested:

- Remove redundant Search buttons because search bars already exist.
- Remove the unrequested `DEMO —` prefix from product names.
- Add product reviews: integer 1–5 stars plus an optional comment.
- Enforce one review per anonymous app identity per product. The owner accepted
  that resets/forged new identities can bypass this and that it is not guaranteed
  one-per-person or one-per-physical-device enforcement.
- Publish immediately. Existing platform admins can hide reviews afterward.
- Translate only the app interface, never merchant-provided product names or
  customer comments. Keep brand display, including the existing demo brand.

Not requested: customer accounts, review editing, merchant rating submission,
prepublication moderation, OCR, catalog translation, new infrastructure, new
families/attributes work, price-history redesign, or a release in this turn.

## Current source/deployment state

All three repositories are on `feat/mobile-merchant-access`, with earlier dirty
merchant/login/localization changes preserved. **A diff against HEAD contains
more than this slice.** Include untracked files when reviewing. No commit or push
was made for this slice.

HEADs at verification:

| Repository | HEAD |
| --- | --- |
| API | `5ca540b1186bf94876a9feff40a9e3ee06bed3e8` |
| Admin | `85d7de6bca95574f23868c2a10d434871ca5bd92` |
| Mobile | `ea17da54ac94f4576751bb2145b073aedb6e8450` |

Review code and migration are **local only**. No review schema change on Neon,
production review flag, API/admin deployment, new native archive, or TestFlight
upload occurred. No dependencies were added by this slice; existing SecureStore
comes from the earlier merchant work. Do not attribute the current package/lockfile
diffs or merchant-access migration to this feature.

### The one live change already made

The owner-requested cleanup removed `DEMO —` from exactly the 12 originally seeded
product names. The script verified original IDs, slugs, brand and names; checked a
preview hash; used a serializable transaction and catalog lock; and verified all
other columns except `updatedAt` unchanged. No merchant name, brand, description,
image, price, offer, slug, or ID was changed. This was not a general rename by prefix
over arbitrary catalog products. No catalog translations were added.

Resulting names:

- Headphone over-ear; Fone intra-auricular; Caixa de som portátil
- Smartphone preto; Smartphone com acabamento claro; Smartphone tela ampla
- Notebook para trabalho; Notebook portátil; Notebook para estudos
- Console de videogame; Par de controles para console; Controle para videogame

Cleanup evidence/script remains locally at
`/private/tmp/achaaqui-catalog-cleanup.oby4GK/rename.cjs`.
It is not a migration or a script to rerun. The approved preview fingerprint was
`b183351b2ba7c17bc49204d1c83e3e420195acbe0bf25ae96db9b1d85b2414b1`.
Database transaction readback verified the change; an installed app must refresh.

## Exact review surfaces

Paths below are repository-relative. New files may be untracked.

### API

- `apps/api/prisma/schema.prisma`: optional product-only target, reviewer hash,
  nullable legacy merchant fields, relation and indexes.
- `apps/api/prisma/migrations/20260916160000_anonymous_product_reviews/migration.sql`:
  reviewed additive SQL; target CHECK, FK, uniqueness and query indexes.
- New `apps/api/src/reviews/product-reviews.dto.ts`,
  `product-reviews.controller.ts`, `product-reviews.service.ts`.
- `apps/api/src/reviews/reviews.module.ts`: register the new endpoints/service.
- `apps/api/src/reviews/reviews.dto.ts` and `reviews.service.ts`: nullable merchant
  fields, product-only admin mapping/search, product aggregates, correct merchant
  aggregate counts. The existing merchant accumulator omitted `ratings.set(...)`;
  that omission was corrected and legacy ratings are covered by the new tests.
- `apps/api/src/config/environment.ts` and `.env.example`: feature flag.
- `apps/api/src/main.ts`: no-store on review paths, including normalized trailing
  slashes. `apps/api/src/common/filters/all-exceptions.filter.ts`: redact exception
  stack arguments on review/identity routes, extending prior credential handling.
- New `apps/api/test/product-reviews.spec.ts` and
  `apps/api/test/product-reviews.integration.spec.ts`.
- `README.md`, `docs/product-reviews.md`, and this handoff.

### Mobile

- `src/components/search-entry.tsx`: remove the redundant red Search text action;
  the search-entry bar remains tappable.
- `src/app/(tabs)/index.tsx`: remove the large standalone Search CTA.
- `src/app/(tabs)/search.tsx`: remove the separate Search CTA. Keyboard Search/Enter
  and the Search tab remain. Clear buttons remain.
- New `src/reviews/identity.ts`, `client.ts`, `product-reviews.tsx`.
- `src/app/product/[slug].tsx`: mount the review section after price history.
- `src/i18n/messages.ts`: English/Portuguese review interface strings only, added
  to the earlier localization system. No per-product translations.
- New `tests/product-reviews.test.mjs`; README release-status notes.

### Admin

- `src/lib/api.ts`: nullable `merchant`, `merchantRating`, `combinedRating` for
  product-only reviews.
- `src/app/reviews/page.tsx`: omit absent merchant/combined scores; update explanatory
  copy. Keep existing authenticated Publish/Reject/Return to pending controls.
- `src/lib/locale-messages.ts`: Portuguese copy; README release-status notes.
- No new admin permission model or merchant review-moderation access.

## How the feature works

Full contract and rollout notes: [product-reviews.md](product-reviews.md).

1. Opening a product lists published reviews. With no saved identity the form is
   available without allocating a credential. A saved identity checks `/mine`.
2. First submission requests a cryptographically random 32-byte hex token from
   `POST /v1/reviews/identity`. This endpoint is stateless; there is no identity table
   or customer account. Token shape is validated, but it is not a signed attestation
   of a genuine device. A fabricated random token is another identity by design.
3. Native persists it using SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`;
   web uses AsyncStorage. It must be saved before the review POST. Offline/read
   failures or corrupt saved data fail closed instead of silently replacing it.
4. `POST /v1/products/:slug/reviews` accepts only `{ rating, comment? }`, with the
   private `X-Review-Token` header. The token is never an admin/merchant credential.
5. The API hashes it with domain-separated SHA-256, checks the active product inside
   a transaction, serializes by reviewer hash, applies quotas, and inserts PUBLISHED.
6. Database unique `(productId, reviewerHash)` is the final duplicate guard.
   Identical retries return the existing row; different second submissions return
   409. No automatic POST retry or public customer update/delete endpoint exists.
7. Admin Reject changes status to REJECTED. Subsequent public reads and aggregates
   exclude it. The row remains, and the owner can still see that their review is
   hidden; that identity cannot submit a replacement. There is no push refresh to
   other clients already displaying cached content.

Comments are trimmed, optional, capped at 1,000 characters and rendered as plain
text. No author name/title is collected. HTML-looking comments do not execute.
New reviews rate the shared product only, not a merchant. Legacy merchant-linked
reviews remain readable and included in the relevant existing aggregates.

## Security boundaries and deliberately accepted limits

- DTO whitelisting rejects client-supplied identity/hash, merchant ID, product ID,
  author and publication/moderation fields. Rating must be an integer 1–5.
- Public list projections expose only ID, rating, comment and timestamp. They do
  not expose the anonymous token/hash, private status or moderation actor.
- `/mine` only resolves the review belonging to the token supplied. Knowing a
  public review ID does not grant editing or moderation rights.
- Existing admin authentication remains required for moderation. Merchant tokens
  and anonymous callers cannot use admin review endpoints.
- Release review requests require HTTPS, refuse redirects, omit cookies and use
  no-store. Existing server CORS allowlists were not broadened. No credentials in
  query parameters; exception responses/credential-path logs are sanitized.
- Chosen basic abuse safeguards: 10 newly created reviews/identity/hour in the
  database, serialized across products; issuance/submission each throttled at
  10/minute using the existing per-IP in-memory limiter.
- Known limitations: another random identity bypasses the per-identity limit;
  browser storage is less protected than native Keychain; existing proxy settings
  can share IP buckets; in-memory limits reset on restart and are not distributed.
  This is not anti-Sybil protection or a guarantee against offensive/spam comments.
- Immediate publication means an inappropriate comment can be visible until an
  admin hides it. This is the approved workflow, not an omitted approval queue.

## Verification performed

Node **22.22.3**, npm **11.19.1**; no global runtime changes.

| Check | Result |
| --- | --- |
| API unit/HTTP suites | 121 tests, 13 files passed |
| API PostgreSQL integration suites | 66 tests, 5 files passed, none skipped |
| API build, lint, typecheck | Passed |
| Disposable migrated DB vs Prisma schema | No difference detected |
| Mobile tests | 29 passed, including 6 review identity tests |
| Mobile lint, typecheck, static export | Passed; 17 routes exported |
| Admin tests | 25 passed |
| Admin lint, typecheck, production build | Passed |
| Scoped browser interaction checks | Passed, fixture-backed only |

The database was a task-labeled `postgres:18.6-alpine` container on localhost,
random mapped port 50104, tmpfs storage, no mounts/persistent volumes. Both
`DATABASE_URL` and `TEST_DATABASE_URL` explicitly targeted it; dotenv was disabled.
All six repository migrations applied there. Review fixtures cleaned to zero rows.
The task-labeled container was then removed and its disposable tmpfs data discarded;
it cannot be recovered and contains no real merchant/customer data. No integration
test connected to Neon or the preserved local database.

Coverage includes immediate publication, strict DTO rejection, public field
projection, private-identity isolation, concurrent/identical retries, direct DB
uniqueness, safe conflict mapping, legacy product/merchant aggregates, admin-only
hiding, aggregate removal, no resubmission after hiding, inactive products,
pagination, hourly quota, HTTP throttling, and feature-off behavior.

Browser checks used Chrome/Playwright and mock APIs, with production requests
blocked. Checked keyboard-only search submission, no redundant Search buttons,
star requirement, optional comment, dropped response then identical retry, reload
persistence, hidden-review state, English/Portuguese interface with unchanged
comments, literal HTML-looking text, offline identity retention, and phone/desktop
widths including 320px. Admin browser checks covered both legacy and product-only
cards, hiding through the existing action, Portuguese, and narrow layout.

Artifacts and scripts (temporary, not repository tests):
`/private/tmp/achaaqui-catalog-cleanup.oby4GK/qa.cjs`, `admin-qa.cjs`,
`review-form-phone.png`, `review-phone-pt.png`, `review-narrow.png`,
`review-desktop.png`, `admin-reviews-desktop.png`, `admin-reviews-phone.png`.
Mobile form and admin phone screenshots were visually inspected. Failed fixture
attempts also left `*-failure.png`; those are not the final successful results.

For fixture QA the Expo bundle temporarily used an intercepted HTTPS fixture URL.
The final local export was rebuilt with `https://api.achaaqui.com/v1`, demo off,
dotenv disabled, and Metro cache cleared; the bundle URL was checked. It was not
published. Do not deploy a temporary fixture export.

## Still unverified / release gates

- Actual iPhone review flow, native SecureStore persistence/locked-device behavior,
  native redirect/network behavior, accessibility with VoiceOver, reinstall/backup
  behavior, and the next native archive/TestFlight build.
- Real Cloud Run/Firebase Hosting end-to-end behavior of these new endpoints,
  production quota fairness, production migration duration, and load testing.
- The feature needs SQL/migration and API/admin rollout approval. An app update
  alone will not enable it.
- Migration first, compatible admin and API before enabling writes, then mobile.
  `PRODUCT_REVIEWS_ENABLED=false` hides/disables review endpoints but does not stop
  the updated API from requiring the migrated schema for aggregate reads.
- Once product-only rows exist, an older API/admin that requires a merchant on
  every review is an unsafe rollback. Disable the feature and keep a compatible
  build; do not treat additive columns as proof of binary rollback compatibility.

Please keep the verdict proportionate: identify concrete security/data-integrity
problems and rollout blockers; do not reintroduce accounts, a review queue, Redis,
device attestation, or translation infrastructure for this approved first version.
