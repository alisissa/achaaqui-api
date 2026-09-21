# Review reporting and personal blocking — local implementation

20 September 2026. Not deployed or included in a native archive. Existing local
commercial/file-import work is preserved; this is a separate review-safety slice.

## Behavior

- Reviews still publish immediately. Customers can report spam, abusive/harmful
  content, or another concern, after selecting a reason and confirming.
- Blocking hides that review and other reviews carrying the same anonymous
  author identity across products, for the blocking installation only. Legacy
  reviews have no reliable author identity: only that individual review is hidden.
- Public rating aggregates do not change because of personal blocks. Admin
  rejection continues to remove a review from public lists and aggregates.
- Customers can explicitly clear all their personal review blocks. This does not
  retract reports. Individual unblock management is not included in this slice.
- Admin Reviews has an **Open reports only** filter, the open count and the five
  oldest unresolved reports for each review. Reject hides inappropriate content;
  **Resolve shown reports** separately closes exactly those displayed reports.
  Reports arriving afterwards are not accidentally closed. No automatic removal
  based on report counts, emails, or moderation SLA is implied. The separately
  approved admin ban addition below is implemented locally on 21 September.

## Contracts and security

The existing `X-Review-Token` credential is reused. Only its domain-separated
hash is stored; neither reporter nor author hashes are returned to customers or
the admin UI. No new customer account or device identifier is introduced.

- `POST /v1/reviews/:id/report` — `{ reason: "SPAM" | "ABUSE" | "OTHER" }`.
- `POST /v1/reviews/:id/block` — no payload.
- `DELETE /v1/reviews/blocks` — clears only the caller's blocks, no payload.
- Existing `GET /v1/products/:slug/reviews` accepts an optional review token for
  personalized filtering; shape stays unchanged. Tokenless reads remain public.
- `GET /v1/admin/reviews?reported=true` filters to unresolved reports. List items
  add `reportCount` and at most five `{id, reason, createdAt}` report records.
- `PATCH /v1/admin/reviews/:id/reports` — `{reportIds: UUID[]}`, one to five unique
  IDs. Existing platform-admin guard and server-action session checks apply.

Public safety writes return `{saved:true}`, reject own/hidden/missing reviews,
validate IDs and payloads, and are gated by `PRODUCT_REVIEWS_ENABLED`.
Personalized responses are private/no-store. Existing review-path logging rules
exclude tokens, bodies and exception stacks containing ORM arguments.

Advisory transaction locks serialize each actor's quota and duplicate checks.
Unique indexes enforce one report and one target-review block per actor. Limits:
20 new reports per rolling day, 500 stored blocks per identity, and 20 HTTP writes
per minute per route/IP. Native anonymous identities can still be reset/forged;
limits are not proof of one physical person or comprehensive anti-spam protection.
Proxy-based rate limits may be shared. Reports do not notify operators: check the
queue routinely and handle support email; moderation staffing remains a release gate.

## Database and release

`20260920180000_review_safety/migration.sql` adds two tables and indexes only.
It contains no enums or catalog updates. Apply the reviewed SQL transactionally
before a separately approved API release; then admin and mobile. Never run the
integration fixtures on Neon or the preserved local database.

Old clients keep browsing/reviewing but do not expose safety buttons. A newer
mobile client on the old API cannot use these actions; deploy the API first.
Rolling back this slice to the immediately preceding API does not require dropping
tables, but temporarily disables reporting/block filtering. Do not drop stored
reports/blocks as part of rollback. Older pre-product-review binaries have separate
rollback restrictions documented in `product-reviews.md`.

## Remaining public-launch work

This is not a declaration of App Store readiness. Broader abuse-filter coverage of
merchant descriptions/promotions, moderation operations, retention/deletion,
provider terms and final public policy still require completion. Update the policy
inventory for report/block hashes and audit records; do not claim indefinite
retention is an approved policy or that hashed identifiers are anonymous.

## Verification on 20 September 2026

- Node 22.22.3 / npm 11.19.1. API: 134 unit tests, 110 integration tests,
  lint, typecheck and build passed. Integrations used a new isolated database in
  the already-verified local PostgreSQL 18 tmpfs container; migrations were applied
  as raw SQL, not Prisma migrate. Neon and the preserved local volume were unused.
- New database tests exercise concurrent report/block duplicates, rolling report
  quotas, block limits, HTTP throttling, identity isolation across products,
  legacy fallback, unchanged global ratings, malformed/forged payloads, admin-only
  resolution, copied IDs, later reports remaining open, and the feature off switch.
- Admin: 27 tests, lint, typecheck and production build passed.
- Mobile: 54 tests, lint, typecheck and 20-route web export passed. New tests cover
  credential-safe requests, persistent identity reuse, no automatic mutation
  retries, invalid paths, storage failures and dynamic Portuguese action labels.
- Isolated Chrome walkthrough against temporary local API/admin servers passed:
  report in Portuguese, block, unblock, admin login, open-report filter, rejection,
  report resolution and public removal. PT/EN customer and admin layouts were
  checked at 390px and 1440px; no horizontal overflow or browser exceptions.
  Corrected a missing Confirm translation and oversized narrow-screen checkbox
  found during visual checks, then reran the walkthrough successfully.
- These are browser checks of the mobile web build, not iPhone/Android validation.
  Native SecureStore interaction, accessibility tooling and release-binary checks
  remain to be exercised before submission. No new native build was created.
- No production migration, deployment, commit, push, paid OCR call or App Store
  change occurred. Existing unrelated working-tree changes were preserved.

## Simple comment filter and admin bans — 21 September 2026

Implemented locally only, with no new dependency or external moderation service:

- `src/reviews/comment-filter.ts` rejects a small explicit PT/EN profanity list
  and direct-threat phrases before a new review is stored (HTTP 422). It handles
  casing, accents and basic obfuscation; it is **not** a semantic abuse detector,
  exhaustive language filter or an App Review approval guarantee. Ordinary
  negative feedback and stars without comments remain allowed. Existing published
  comments are not retroactively changed by this filter. Admin publishing also
  checks comments/titles; it cannot bypass the filter.
- Mobile explains filter rejection in PT/EN and preserves the entered comment.
  HTTP 403 explains that this anonymous identity cannot post and gives support
  contact. Neither error resets the identity or automatically retries submission.
- Admin Reviews has **Ban and hide reviews** and **Unban reviewer**, both requiring
  an unchecked confirmation. A ban atomically hides all reviews from the identity
  and prevents new submissions, identical submit retries and manual publishing.
  Unban only permits future posts; it does not republish reviews, erase reports,
  clear personal blocks or remove the existing one-review-per-product restriction.
- Legacy reviews without a reviewer identity cannot be author-banned; admins can
  still reject them individually. Anonymous identity reset/forgery can bypass a
  ban, as already accepted for this build. No physical-device/person ban is claimed.

### Contract and concurrency

`PATCH /v1/admin/reviews/:id/reviewer-access` accepts
`{banned: boolean, confirmed: true, expectedRevision: UUID | null}`. The platform
admin guard applies; the server derives the author from the review, never a
client-supplied hash. Admin list items add `reviewerAccess: {banned, revision}` or
`null` for legacy authors. The property is optional in admin for older APIs.
No raw identity or hash is returned to either UI.

`20260921090000_reviewer_bans/migration.sql` adds only `ReviewerBan`: protected
author hash, active status, revision and last administrative actor/timestamps.
It is a latest-state audit record, not a full audit-event history. Submit, ban,
unban and moderation use the existing author advisory lock. Stale admin revisions
return 409; the UI asks the operator to refresh and check the result, not blindly
retry. ORM stacks on administrative review errors are suppressed too.

Apply this reviewed SQL **before the API**, then admin/mobile, only in a separately
approved rollout. No production SQL was run. Do not drop ban records to roll back.
If reverting to an API without enforcement, disable `PRODUCT_REVIEWS_ENABLED`
first and keep submissions disabled until bans are enforced again. The older
binary otherwise allows banned identities to post.

### Verification

- API: 159 unit tests and 114 integration tests passed, including filter/negative
  feedback, admin authorization, forged and incomplete payloads, no hash leakage,
  all-product hiding/aggregates, legacy fallback, stale decisions and concurrent
  ban/submission/publishing. Tests used only a fresh disposable PostgreSQL 18 DB.
- Admin: 28 tests; mobile: 56 tests. Lint/typechecks, API/admin builds and mobile
  20-route web export passed. Existing unrelated tests remain included.
- Isolated Chrome exercised reporting/blocking plus real filter rejection,
  preservation/correction of the comment, publication of negative feedback,
  confirmed admin ban, rejected subsequent posting and unban/future posting.
  Hidden reviews stayed hidden. PT/EN screenshots at narrow/desktop sizes were
  checked: no horizontal overflow or browser exceptions.
- Native-device QA remains pending. No native archive, deployment, commit, push,
  provider call or App Store change was made. Keep moderation operations, broader
  merchant-content coverage and privacy/retention decisions on the release list.

### Filter correction after review — 21 September 2026

Removed whitespace from the profanity-letter separators: ordinary phrases such
as "It's hit or miss" and "that's hit the spot" must not match across words.
Regression coverage includes spaces, tabs and newlines; dotted spellings and
digit substitutions remain blocked. Fully spaced-out spellings are deliberately
not joined, avoiding this false-positive class. The Portuguese word list and
ban enforcement are unchanged. This correction is local only, with no DB changes.
