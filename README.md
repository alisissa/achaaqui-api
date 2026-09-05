# Catalog platform

This repository is the server-side workspace for the catalog product.

- `apps/api` — NestJS REST API and Prisma/PostgreSQL data model.
- `docs` — architecture decisions and the implementation tracker.

The customer app lives in `achaaqui-mobile`, and the operational web app lives in the user-provided `achaaqui-admin` repository. The product name is AchaAqui; package identifiers, production hosting, and authentication provider remain intentionally unresolved.

## Requirements

- Node.js 22.22.3 (see `.nvmrc`)
- npm 11+
- Docker with Compose, or another local PostgreSQL 16+ instance

## Local setup

```bash
nvm use
npm install
cp apps/api/.env.example apps/api/.env
# Replace the two example secret values before starting the API.
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
```

The API is served at `http://localhost:3001/v1`. Swagger UI is at `http://localhost:3001/v1/docs`, and the OpenAPI JSON document is at `http://localhost:3001/v1/openapi.json`. Swagger defaults off outside development. Admin endpoints require the server-side bearer key configured as `ADMIN_API_KEY`.

## Merchant CSV imports

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
source timestamp and never reactivate an offer. The first bounded version accepts CSV up to 500 rows/2 MB. XLSX and
saved merchant-specific mappings remain deferred.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

See [docs/architecture-decisions.md](docs/architecture-decisions.md) for current technical decisions and [docs/implementation-tracker.md](docs/implementation-tracker.md) for scope and status.
