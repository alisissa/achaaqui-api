# Catalog platform

This repository is the server-side workspace for the catalog product.

- `apps/api` — NestJS REST API and Prisma/PostgreSQL data model.
- `docs` — architecture decisions and the implementation tracker.

The customer app lives in `achaaqui-mobile`, and the operational web app lives in the user-provided `achaaqui-admin` repository. The product name is AchaAqui. Production runs on Cloud Run in `us-east4` with Neon PostgreSQL. Firebase platform-admin authentication is implemented; merchant self-service remains disabled. The API is not deployed by this repository's CI.

## Requirements

- Node.js 22.22.3 (see `.nvmrc`)
- npm 11.19.1 (pinned in `packageManager`, Docker, and CI)
- Docker with Compose, or another local PostgreSQL 16+ instance

## Local setup

```bash
nvm use
npm install --global npm@11.19.1
npm ci
cp apps/api/.env.example apps/api/.env
# Replace the two example secret values before starting the API.
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
```

The API is served at `http://localhost:3001/v1`. Swagger UI is at `http://localhost:3001/v1/docs`, and the OpenAPI JSON document is at `http://localhost:3001/v1/openapi.json`. Swagger defaults off outside development. Local shared-key mode requires the server-side bearer key configured as `ADMIN_API_KEY`; production uses Firebase authentication instead.

The owner-approved cloud API is now public, with Swagger explicitly enabled:
[API documentation](https://api.achaaqui.com/v1/docs/). Its root redirects to
`/v1/docs/`; API routes retain `/v1`. Production administrative operations require
a Firebase Google ID token (`Authorization: Bearer <token>`) or an admin-issued
Firebase session (`Authorization: Session <cookie>`). Both require the
`role: platform_admin` claim and a current, enabled, verified Google user with
that role. Shared API keys and merchant-role tokens are rejected in production.
Actor IDs are derived from the verified Firebase UID, never supplied by clients.
See the [current authentication/deployment handoff](../achaaqui-admin/docs/firebase-admin-release.md)
and the historical [public API release](docs/public-api-2026-09-11.md).

Use the declared npm version: older npm 11 workspace resolution can silently
retain vulnerable transitive packages despite root overrides. See the
[dependency remediation and verification](docs/dependency-remediation.md).

## Merchant CSV and Excel imports

The current import slice exposes protected endpoints under `/v1/admin/imports`
for upload, history, preview, commit, and cancellation. The canonical fields are
`merchantSku`, `productName`, `brand`, `model`, `barcode`, `price`, `currency`,
`stock`, and `availability`; common English and Portuguese aliases are also
accepted.

Parsing writes staging rows only. Matching uses an existing merchant SKU first
and an exact product barcode second. Invalid or uncertain rows never commit.
Commits are explicit, transactional, and idempotent per import. Warning rows
require an unchecked operator acknowledgement. Overlapping imports for one
offer are serialized and stale previews are rejected. Actual price or currency
changes create truthful price history; unchanged rows only refresh the offer
source timestamp and never reactivate an offer. CSV and XLSX share this pipeline,
with limits of 500 rows/2 MB. Protected downloads provide blank CSV/XLSX templates
or a merchant's current active offers for editing and re-uploading. Excel inputs
are bounded before parsing and reject formulas, numeric barcodes, unsafe numeric
SKUs, hidden rows, merged cells, macros, and extra data sheets. Nonnegative integer
SKUs of at most 15 digits with plain number formatting are accepted with an
explicit leading-zero warning that must be acknowledged, even for unchanged
rows. Keep identifiers as Text whenever possible. Boolean availability values
are accepted; stock contradictions still fail validation. Native Apple Numbers
files must be exported to Excel (.xlsx) or CSV. Saved custom mappings remain deferred.

## Individual merchant offers

The protected `/v1/admin/merchants/:merchantId/offers` endpoints support listing,
adding, editing, removing, and restoring merchant offers. Operators can select an
existing catalog product or create a new product and its first offer atomically.
Removal hides only the merchant's offer and preserves shared products and history.
Explicit confirmation, optimistic versions, and the same transaction locks as
imports protect manual edits. These are administrator-operated workflows, not
merchant self-service authentication.

See [merchant workflows and template rules](docs/merchant-workflows.md), the
[local testing checklist](../achaaqui-admin/docs/merchant-testing.md), and the
[GCP migration plan](docs/gcp-migration-plan.md). Cloud and DNS changes are not
part of this implementation.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:deployment
npm run test:integration
npm run build
```

See [docs/architecture-decisions.md](docs/architecture-decisions.md) for current technical decisions and [docs/implementation-tracker.md](docs/implementation-tracker.md) for scope and status.

## Cloud Run preparation

The [API-only deployment review](docs/cloud-run-api.md) includes a private-first
service template, scale-to-zero settings, explicit connection-pool limits, and
secret/IAM approval gates. Builds exclude local environment files and need no
database credentials. `npm run test:deployment` validates the intended template
offline; it never contacts GCP. No cloud deployment, automatic push, admin rollout,
or domain change is included.
