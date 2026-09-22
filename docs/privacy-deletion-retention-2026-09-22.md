# Privacy release: implementation and Claude review

Status: **committed and pushed; production rollout pending backup approval**.
See the 22 September release checkpoint below. No production records were deleted,
no migration applied to Neon, no scheduler/IAM resources created, and no native
build cut in this slice. Website draft and noindex stay until publication.

## Scope

- Daily search-statistics cleanup, using the existing 90-day cleanup method.
- Delete an author's product review with their existing anonymous app identity.
- Admin-only deletion of merchant login credentials after a verified request.
- Plain-language Portuguese privacy/support pages on the existing static site.

No customer login, new identity system, account-management dashboard, generic
privacy platform, website redesign, or new dependencies. The prior mobile
per-photo consent work is preserved and belongs in the same native release.

## Changes to inspect

| Area | Files | Behavior |
| --- | --- | --- |
| Review deletion | `apps/api/src/reviews/product-reviews.{controller,dto,service}.ts` | `DELETE /v1/products/:slug/reviews/mine`, body `{reviewId, confirmed: true}`, existing `X-Review-Token`; 204, private/no-store. No match returns the same 204, not an existence oracle. |
| Review safety | `review-safety.service.ts`, `reviews.service.ts`, Prisma schema and `20260922100000_privacy_deletion/migration.sql` | Same author lock as submit/ban; report/block holds a shared review-row lock; moderation rereads after its author lock. Hard-deletes the rating/comment and linked reports. Author blocks and bans survive. |
| Rate-limit preservation | `ReviewDeletionReceipt` and creation quota | Stores only random receipt ID, author hash and deletion time, never comment/rating/product. Counts with surviving submissions against 10/hour. Daily cleanup removes receipts older than 24 hours (normally less than 48 hours total). |
| Mobile | `../achaaqui-mobile/src/reviews/client.ts`, `product-reviews.tsx`, `src/i18n/messages.ts` | EN/PT delete, explicit confirm/cancel; handles empty 204; no automatic mutation retry; retains identity on failures; invalidates product/list/rating cache after success. |
| Merchant login | `apps/api/src/merchant-access/merchant-access.{controller,dto,service}.ts` | Admin-only DELETE on existing `/v1/admin/merchants/:merchantId/login`; exact expected user ID/revision, verified-request case ID and two mandatory true confirmations. Deletes user/password hash and cascading sessions. |
| Retention | `apps/api/src/analytics/retention-job.ts`, `deploy/cloud-run/retention-*.template.*` | Non-HTTP one-shot job, no dotenv, explicit enable flag, one DB connection, counts-only logs; daily Scheduler candidate for 03:00 São Paulo. |
| Website | `../achaaqui-web/public/privacidade.html`, `suporte.html`, `test/site.test.mjs` | Operator Ali Issa, contact, purposes/bases, permissions, international processing, retention, deletion, ANPD and children. Internal implementation notes removed from policy body. |

### Product choices and limits (do not hide these in the handoff)

- Deleting a review permits a new review later; uniqueness is **one current
  review per product per anonymous identity**, not one lifetime submission.
  A retry includes the exact deleted ID, so it cannot delete its replacement.
  Deletion/reposting does not reset quotas or bans.
- The deletion API accepts an owned review even when the product is inactive
  or the author is banned. The normal mobile product page cannot be opened for
  an inactive product; that edge case goes to support in this version. There is
  no new “all my reviews” dashboard. Lost app identities cannot be reconstructed
  from an email, product name, date or public comment.
- Removing login credentials is **not erasing the entire merchant**. Store,
  shared catalog, offers, import/history and moderation records are preserved.
  Other deletion requests need a separately scoped operator action.
- Admin `GET .../login` adds `id` and `updatedAt` inside the existing wrapper;
  the existing admin page needs no change. No deletion UI was added there.
- An admin's `ownershipVerified` boolean attests to the manual procedure below;
  it is not independent technical proof that an email owns the store.

## Verified-request procedure (manual, deliberately small)

1. Receive the request at `alisissa@gmail.com`. Record an opaque UUID case ID in
   a private, access-controlled support record, with scope, date, verification
   method, operator and outcome. Never save requests or secrets in Git.
2. For merchant access, establish authority using the **original independently
   verified onboarding contact/channel**, not a newly supplied email, public
   store contact, or knowledge of the username. If no verified channel exists,
   resolve authority with the owner before deleting. Never ask for passwords,
   session/review tokens, or unnecessary identity documents by email.
3. Confirm scope: login only versus public listing/contact/import data. Obtain
   explicit confirmation. Do not delete shared products or commercial history
   merely because a login is being closed.
4. Authenticated platform admin GETs the exact merchant login just before the
   change. Send DELETE to that same merchant with:

   ```json
   {
     "expectedUserId": "UUID_FROM_FRESH_ADMIN_READ",
     "expectedUpdatedAt": "ISO_TIMESTAMP_FROM_FRESH_ADMIN_READ",
     "requestId": "PRIVATE_CASE_UUID",
     "ownershipVerified": true,
     "confirmed": true
   }
   ```

   Use the existing secure admin transport. No bearer credentials in URLs,
   commands saved to history, source, logs or support mail. A 409 means reread
   and reverify; do not replace the expected revision and silently retry.
5. Read back `{login:null}`. Verify revocation without printing credentials.
   Record completion and explain precisely what was removed and what remains.
   The API records actor, merchant and case IDs in its operational audit log.
6. For anonymous reviews, prefer in-app deletion: possession of the existing
   private identity is the proof. Public review details locate a record but do
   not authorize its deletion or disclosure. Escalate inaccessible/lost-identity
   cases; inappropriate public content can separately be moderated on its merits.
7. Review support records and retained merchant/import data on case closure and
   periodically thereafter. Remove information no longer needed; document an
   actual legal/security reason and review date for exceptions. No claim of an
   implemented blanket import purge or automatic support-mail deletion.

### Backups and restoration

Production backups from earlier approved releases were not changed. Before
publication, inventory the actual Neon recovery window and owner-held dumps,
approve a finite maximum lifetime for the local copies, and put their expiry
dates into the private operating checklist. Do not guess the Neon window from
the historical Free-plan note. The policy currently describes behavior, not an
unverified numeric backup promise.

Keep a private minimal deletion ledger (record IDs/case IDs and cutoff dates,
not passwords/comments). Before reopening a restored database, reapply completed
deletions, current bans/revocations, and expired analytics cleanup. A dump alone
is not evidence that restoration preserves privacy decisions. Test this on a
disposable restore before relying on it. Deleting old backups remains a separately
approved action with exact paths; no wildcard or recursive deletion instructions.

## Retention job rollout (NOT executed)

1. Review SQL, back up under separately approved handling, apply migration as
   raw SQL before API/job deployment. Do not use `prisma migrate` on production.
2. Build/verify the API image; the same packaged image contains
   `apps/api/dist/analytics/retention-job.js`. Pin its immutable digest and the
   approved database-secret version in the job template.
3. Exact cloud target: project `achaaqui-web`, region `us-east4`, explicit named
   configuration `achaaqui` and account `alisissa@gmail.com` on all commands.
   No global account/config change and no Bubu project.
4. Runtime identity `achaaqui-retention@achaaqui-web.iam.gserviceaccount.com`
   gets accessor on the **database secret only**. Trigger identity
   `achaaqui-retention-trigger@achaaqui-web.iam.gserviceaccount.com` gets
   `roles/run.invoker` on **this job only**, no database access. No user-managed
   service-account keys. Review the runtime database role separately; a narrow
   cloud binding does not reduce the SQL credential's existing privileges.
5. Run once and verify execution success, remaining oldest analytic timestamp,
   cascaded hits and receipt ages. Counts-only job logs must not contain queries,
   IPs, tokens or DB errors. Exit failure if disabled/misconfigured.
6. Enable the Scheduler API only with rollout approval, apply the JSON candidate
   after the job exists, and verify its OAuth target, schedule and time zone.
   The Scheduler role authorizes invocation; no public cleanup URL is introduced.
   A successful Scheduler HTTP response is **not** proof that the job finished.
7. Check Cloud Run execution result and actual data ages daily during the pilot;
   add failure/stale-run alerting before unattended operation. Retry is bounded
   (one per job task, one Scheduler retry). Duplicate executions are idempotent.
   Overdue records can remain during an outage; the policy says daily cleanup,
   not an impossible exact-to-the-second guarantee.
8. Read back identities, grants, deployed digest, pinned secret and cost controls.
   Job/scheduler may incur usage; existing budgets are alerts, not hard caps.

Google's official [Jobs + Scheduler guide](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
supports the OAuth POST to the v2 jobs `:run` endpoint. This is a candidate,
not a claim the templates were applied or cloud schema/IAM tested live.

## Policy evidence and remaining publication gates

- Mistral training off/Labs off: **owner-confirmed 21 Sep**, not independently
  reverified this turn. Do not ask for the API key or repeatedly require the
  same toggle confirmation. Opt-out is not ZDR.
- [Mistral ZDR documentation](https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr)
  distinguishes training opt-out from separately approved zero-retention settings.
  [DPA](https://legal.mistral.ai/terms/data-processing-addendum/) covers business
  processing and separate moderation purposes. The generic
  [retention help page](https://help.mistral.ai/en/articles/347628-how-long-do-you-store-my-data)
  does **not** establish this organization's OCR input retention window.
  Confirm the effective API tier/contract and OCR retention before publication;
  do not substitute consumer chat retention or assert “30 days” without evidence.
- Google's `_Default` 30 days and `_Required` 400 days were live-read on **21 Sep**
  in the previous check, not refreshed this slice. Read back again before release.
  [Log storage](https://docs.cloud.google.com/logging/docs/store-log-entries) and
  [HTTP request log fields](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)
  support the distinction from hashed search statistics.
- [ANPD rights/petition guidance](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular)
  supports the contact/complaint route. Legal bases, legitimate-interest balancing
  (limited internal statistics, no cross-app tracking/ads), provider agreements,
  international transfer mechanisms and child audience still need owner/legal
  review. This draft is not certification of LGPD/GDPR compliance or Apple approval.
- Publish neither daily-cleanup claims before the job is operating nor in-app
  deletion/consent claims before the reviewed mobile build is available. Remove
  preview banners/noindex **at publication**, not during review. Old pilot builds
  lack the new photo-consent gate; retire their access or restrict them to the
  operator before inviting merchants.

## Verification

Node 22.22.3 / npm 11.19.1. All API SQL migrations, including the new one,
were applied as raw SQL to a fresh PostgreSQL 18.6 localhost-only tmpfs container.
Both DATABASE_URL and TEST_DATABASE_URL pointed only there; dotenv was disabled.
The test container/tmpfs was removed; preserved local database volume untouched.

- API: 164 unit/security tests; 120 integration tests across 8 files, none
  skipped. Lint/typecheck/build, 6 existing deployment-template tests and
  8 installed-dependency checks passed. No dependency versions changed.
- New integration cases: exact author, copied/missing token, false confirmation,
  wrong slug, two simultaneous deletes, exact-once receipt, stale retry versus
  replacement, immediate aggregate change, hidden/inactive/banned review removal,
  blocks/bans preserved, delete/repost quota, simultaneous report/block versus
  deletion without dangling references; admin auth and confirmations,
  revision/user mismatch, session revocation, reprovision protection, unrelated
  catalog preservation; disabled cleanup job, 90-day boundary, cascading hits,
  short receipt cleanup and repeated job execution.
- Mobile: 60 tests; lint/typecheck and static web export passed. No native build
  or physical-device test in this slice.
- Static site: 9 tests and local build passed; no Firebase publication.
- Local Chrome, mocked API, EN/PT at 390px: explicit confirm/cancel; cancel sends
  no DELETE; a 500 keeps review and identity; subsequent 204 removes both own
  card and public-list entry; saved identity unchanged; no horizontal overflow
  or runtime errors. Both confirmation screenshots were visually inspected.
  This is web-rendered mobile QA, not physical iOS/Android or live API browser QA.
  Website copy was static-tested/built, not freshly browser-inspected this slice.
- Mocked `qa.invalid` web export was replaced by a fresh export using the existing
  local environment afterward; the mock host no longer appears in generated JS.
  No environment files changed. This restored export is not a production artifact.

## Rollback

Schema is additive for receipts but changes `ReviewBlock.reviewId` to nullable.
An old client/API that assumes a non-null ID can fail after deletions. Disable
reviews before rolling API back past this migration; do not undo the schema or
restore deleted reviews just to make an old binary work. Old review binaries also
do not include receipt quota accounting. Pause the Scheduler only if diagnosing
the job; record missed cleanup and catch up before claiming retention is met.

## Claude focus

Review deletion/submit/moderation/report races, nullable-block compatibility,
quota receipts, captured merchant actors after login deletion, job-only config,
mobile confirmation/cache/error behavior, and policy claims versus actual
deployment. Distinguish this local candidate from production, and existing
photo-consent changes from this turn. No further feature expansion is proposed.

## Release checkpoint — 22 September 2026

- Reviewed API source `634cd51aa72a3cfc8d3d2b27390b55e6db8281c3` and mobile
  source `1d20cb6695b3ea175e99d1618686378facf6d1f2` were committed on release
  branches, fast-forwarded into their separate `main` branches and pushed.
  Admin was unchanged. Static website is not a Git repository.
- Fresh checks passed: API 164 unit/security + 120 disposable PostgreSQL 18.6
  integration tests, lint/typecheck, 6 deployment and 8 dependency checks;
  mobile 60 tests and lint/typecheck. No production database used for tests.
- Built `achaaqui-api:privacy-634cd51` for Linux/amd64. Local OCI index
  `sha256:5b0ff8a41591cf22026850623e0b7d2bd9fc77a9e1ca57a40dc8a82b35dabcf7`;
  platform manifest
  `sha256:3bda3b5a11313dee82216c644ddc2ce873e4f141ef891d3c4320868a16baf834`.
  These are local artifacts, not registry-push or deployment evidence.
- iOS 0.1.0 (10) archived and exported locally. IPA SHA-256
  `593ed5965bf697fe7b37411cf3953c9860cd28bd6c989ea88b15d18d9ef23b8b`.
  Verified distribution signature/team/bundle, production API, demo mode off,
  compiled consent/deletion strings, camera/photo permissions and no microphone
  permission. Internal TestFlight only, not public-submission eligible.
  **Not uploaded**; no physical-device QA claimed.
- Read-only production preflight: API `achaaqui-api-00011-797`, admin
  `achaaqui-admin-00007-4ns`; API min 1/max 1, admin min 0/max 1. Both still use
  Firebase admin auth. Ten applied Neon migration checksums match source;
  counts: 23 products, 3 merchants, 2 reviews, 1 merchant login, 7 imports.
  Eight search events, none older than 90 days. No rows were changed.
- Cloud Logging retention readback: `_Default` 30 days, `_Required` 400 days.
  EUR 20 alert budget remains; this is not a hard spending ceiling. Retention
  identities/job are absent and Scheduler API is disabled.
- The approval system rejected the full database export because this new
  sensitive destination had not been explicitly approved. Requested permission
  for `/private/tmp/achaaqui-privacy-release-20260922.ujxGs2/neon-before.dump`
  with owner-only permissions and isolated restore verification. No backup,
  production SQL, registry push, deployment, job/schedule or publication occurred.
  Resume at backup approval, then follow the reviewed release order.
- Firebase Hosting release metadata request returned HTTP 403; resolve before
  publication. Provider/backup-policy gates above remain. Mistral's current
  [ZDR documentation](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention)
  confirms that training opt-out is separate from ZDR, not evidence this
  organization's OCR calls have zero retention.
- The historical protected local Docker volume was not found in the current
  `desktop-linux` inventory. No replacement was created and no persistent volume
  was removed. Release tests used explicitly labeled disposable tmpfs containers.
