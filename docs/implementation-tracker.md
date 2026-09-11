# Implementation tracker

Last updated: 2026-09-06

## Phase 0 — audit and decisions

- [x] Inspect both repositories, Git state, READMEs, instructions, and tooling.
- [x] Inspect all five visual references at original resolution.
- [x] Record repository boundaries and reversible defaults.
- [x] Define the first vertical slice and acceptance criteria.

## Phase 1 — first vertical slice

- [x] PostgreSQL Compose setup, Prisma schema, migrations, and repeatable seed.
- [x] NestJS configuration, validation, security headers, CORS, graceful shutdown, health/readiness, and OpenAPI.
- [x] Public categories, product list/search, product details/offers/history, and merchant endpoints.
- [x] Expo Router foundation and original visual tokens.
- [x] Mobile home, search, categories, product details, merchant details, and local favorites.
- [x] Useful loading, empty, error, and retry states.
- [x] API unit/contract tests and API/mobile lint, type checks, and builds.
- [x] Document local end-to-end setup and verification commands.

### Acceptance criteria

- A fresh local database can be migrated and seeded with categories, brands, three merchants, ten products, multi-merchant offers, and price history.
- Anonymous clients can browse and search products and see currency-safe merchant offers with availability and freshness.
- The mobile app consumes the real REST contracts and keeps favorites after restart.
- The API exposes OpenAPI and rejects unknown or invalid external input.
- Lint, type checks, automated API tests, and production builds pass in both repositories.

## Phase 2 — admin essentials (started)

- [x] Scaffold the separate user-provided `achaaqui-admin` Next.js repository.
- [x] Add temporary private-beta site credentials, signed sessions, login throttling, and server-side API-key guards.
- [x] Create merchant directory and merchant creation workflow.
- [x] Add customer review schema, public rating aggregates, and admin moderation.
- [x] Add privacy-minimized search events, merchant-product hits, and admin reporting.
- [ ] Replace temporary credentials with Firebase Authentication and explicit administrator/merchant roles.
- [x] Administrator-operated, merchant-scoped offer creation/edit/removal/restore with truthful manual price history and stale-edit protection.
- [x] Atomic creation of a shared catalog product and its first merchant offer.
- [ ] Add a merchant onboarding/request policy after the administrator workflow is proven.

## Phase 3 — CSV/XLSX import (started)

- [x] Canonical CSV parse → normalize → exact match → validate → preview → commit pipeline.
- [x] Staged raw/normalized rows, merchant-SKU/barcode matching, validation warnings, cancellation, and audit history.
- [x] Explicit operator warning confirmation plus transactional, per-import idempotent commits.
- [x] Database-backed import tests for concurrent imports, commit/cancel races, stale previews, inactive offers, currency changes, idempotency, and conflicting matches.
- [x] Refresh offer freshness for verified unchanged rows without creating false price history.
- [ ] Reusable merchant-specific column mappings and mapping snapshots.
- [x] XLSX input feeding the same shared pipeline, with bounded ZIP expansion and plain-cell validation.
- [x] Downloadable blank CSV/XLSX templates and current-offer templates for testing and bulk price maintenance.
- [x] Shared transaction locks and version snapshots across manual edits and imports, including inventory-only changes/removal.
- [ ] Merchant-authenticated, merchant-scoped self-service imports.

## Explicitly deferred

Production deployment, cloud resources, EAS publishing, account changes, Google Sheets, OCR/PDF/WhatsApp assistance, alerts, customer accounts, Redis, Elasticsearch, Kubernetes, and microservices.

## Audit remediation completed on 2026-09-05

- Imports re-read and lock live offer state at commit time; a stale preview now fails instead of writing a false price-history predecessor.
- Cancellation conditionally claims only cancellable imports, and unchanged rows no longer reactivate disabled offers.
- Price history records both old and new currency, and database checks protect money, currency, and stock fields.
- Public catalog responses expose lowest prices per currency and never declare a single best offer across currencies.
- Saved products refresh live catalog values and clearly label their local snapshot fallback.
- Customer searches are recorded only on explicit submission; request logs omit query strings.
- Trust-proxy and Swagger exposure are explicit configuration decisions with safe defaults.
- API and admin container definitions and CI checks exist, but no cloud resources have been created and no deployment has occurred.

## Remaining release gates

- Replace temporary shared administrator access with Firebase ID-token verification, roles, and service-layer merchant scoping before public use.
- Rehearse the production migration, backup, and restore procedure against the selected managed PostgreSQL provider.
- Configure production secrets, budget alerts, region, retention scheduling, error reporting, and deployment access deliberately.
- Generate or validate mobile contracts against OpenAPI in CI and measure search indexing requirements with realistic data.

## Merchant next steps

1. Firebase sign-in, invitations, account recovery, administrator/merchant roles, merchant ownership checks on every read/write, and real actor IDs. Current ID-scoping tests do not replace authenticated cross-tenant tests.
2. Merchant profile editing/deactivation: address, contact details, website, logo, and onboarding approval.
3. Product images/descriptions and a platform-admin correction/duplicate-review flow for the shared catalog.
4. Saved merchant column mappings and downloadable row-error reports after testing real merchant spreadsheets.
5. Price freshness reminders and a complete operator activity trail, including stock changes and removals.

Google Sheets, OCR/PDF/WhatsApp, automatic fuzzy matching, and large asynchronous
imports remain later features. See [merchant workflows](merchant-workflows.md)
and the planning-only [GCP migration plan](gcp-migration-plan.md).
