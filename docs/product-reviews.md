# Anonymous product reviews — 16 September 2026

Deployed with owner approval on 16 September 2026. The reviewed raw SQL migration
and compatible admin/API are live; production has `PRODUCT_REVIEWS_ENABLED=true`.
The code default remains `false`. See [the release record](reviews-release-2026-09-16.md)
for immutable images, verification, backup and rollback limits. Mobile build 5 is
prepared but not uploaded to TestFlight.

## Approved behavior

- One review per anonymous app identity per shared product, across all stores.
- Integer 1–5 stars and an optional comment (maximum 1,000 characters).
- Publish immediately; platform admins can hide through existing moderation.
- No customer login, device fingerprinting, customer editing, or merchant rating
  submission. Existing legacy merchant/product reviews remain supported.
- Translate interface text only. Product names and comments remain as supplied.

The owner explicitly accepted that this is not proof of a unique physical device
or person. Clearing/loss of storage or creating another token can bypass it.

## Contracts

All paths have the `/v1` prefix and are gated by the feature flag.

| Method/path | Result |
| --- | --- |
| `POST /reviews/identity` | `{ token }`, random 32-byte hex token, no account |
| `GET /products/:slug/reviews?page=&pageSize=` | Published `{ id, rating, comment, createdAt }` records and pagination |
| `GET /products/:slug/reviews/mine` | `{ review: null \| { id, rating, comment, status, createdAt } }` |
| `POST /products/:slug/reviews` | `{ rating, comment? }` → the saved own-review object |

The last two endpoints require `X-Review-Token`; merchant/admin credentials are
not used. Creation and identical retries both return HTTP 200. A different second
submission returns 409. The client never automatically retries a write. Inactive
or unknown products return 404. Unknown body fields are rejected.

Admin review responses now allow `merchant`, `merchantRating`, and
`combinedRating` to be null for product-only reviews. Existing public catalog
response shapes are unchanged; published product-only reviews contribute to the
existing product rating aggregates, not merchant scores.

## Persistence and safety

The additive SQL migration is
`apps/api/prisma/migrations/20260916160000_anonymous_product_reviews/migration.sql`.
It adds nullable `productId`/`reviewerHash`, makes legacy merchant fields nullable,
and enforces either the old review shape or the new product-only shape with a
CHECK constraint. A foreign key and unique `(productId, reviewerHash)` index
protect the new rows. No legacy review is backfilled or deleted.

Only a domain-separated SHA-256 hash of the token is stored with a review.
Neither the credential nor its hash is returned in public/admin review lists.
Native storage uses the existing SecureStore dependency; web uses AsyncStorage.
Storage read failures do not reset the identity. The client persists a new token
before submitting a review. Release requests require HTTPS, omit cookies, refuse
redirects, and use no-store. Review routes suppress exception stack arguments in
logs and return sanitized errors. Existing CORS allowlists remain unchanged.

An identity-scoped transaction lock serializes writes and the hourly count;
the product is checked active inside that transaction. Identical retries return
the existing row, including after moderation. Database uniqueness conflicts map
to 409. Hiding a review keeps the row, so it cannot be resubmitted by that identity.

Limits: 10 new reviews per identity per hour (database-backed); issuance and
submission each have a 10/minute route throttle using the existing IP limiter.
These are basic safeguards, not strong anti-Sybil protection. The existing proxy
configuration can share a bucket across users, and the in-memory IP limit resets
on restart/is not distributed. No new IP/proxy infrastructure was introduced.

## Rollout and rollback procedure

The production rollout below was approved and completed; the physical-iPhone
checks and TestFlight upload remain outstanding. Future mutations still require
their own authorization.

1. Review SQL and take the normal database recovery precautions. Apply only the
   reviewed migration to the verified target through the approved process.
2. Deploy the nullable-field-compatible admin before enabling new review writes.
3. Deploy the matching API with `PRODUCT_REVIEWS_ENABLED=false`; verify existing
   catalog, merchant authentication, and admin moderation.
4. Enable the flag only when the API and admin are both compatible. Smoke-test
   against an explicitly approved test product/identity, not a real customer.
5. Prepare the next native build; verify physical-iPhone persistence, keyboard
   submission, restart, network failure, and admin hiding before TestFlight.

The mobile review section disappears when the server returns 404, so an older or
disabled API remains usable. Existing catalog clients retain their response
shapes. Turning the flag off stops new review endpoint access but does not delete
data. Once product-only rows exist, do **not** roll back to old API/admin binaries
that assume every review has a merchant. Keep a compatible build and roll forward;
the flag alone does not make those old binaries compatible.

## Verification and limits

API unit/HTTP and disposable-database integration tests cover validation, privacy,
immediate publication, legacy aggregates, different identities, concurrent and
identical retries, database uniqueness, admin-only hiding, continued duplicate
blocking after hiding, inactive products, quotas, and flag-off behavior.

Browser fixtures cover search Enter submission, review form validation, lost
response/retry, persistence after reload, hiding, English/Portuguese text, literal
HTML-looking comments, offline identity retention, and narrow/desktop layouts.
They are not native-device or deployed end-to-end tests.

For the complete scoped review request, current test counts, and the separate
live product-name cleanup, see
[the Claude handoff](claude-review-product-reviews-2026-09-16.md).
