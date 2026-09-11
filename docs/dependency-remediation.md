# API dependency remediation — 11 September 2026

Local package fixes only; no cloud changes, image push, deployment, commit, or
Git push. Existing merchant-feature work is preserved. NestJS remains 11.2.3,
Prisma remains 7.10.0, and ExcelJS remains 4.4.0.

## Reviewed changes

| Dependency | Previous | Fixed | Selection |
| --- | --- | --- | --- |
| `csv-parse` | 6.1.0 | 7.0.2 | Direct dependency; safe column properties and repaired CommonJS export |
| `multer` | 2.2.0 | 2.3.0 | Scoped override under `@nestjs/platform-express@11.2.3` |
| `deepmerge-ts` | 7.1.5 | 8.0.2 | Scoped override under `@prisma/config@7.10.0` |
| `mysql2` | 3.15.3 | 3.24.4 | Scoped override under `prisma@7.10.0`; API database remains PostgreSQL |
| `uuid` | 8.3.2 | 11.1.1 | Scoped override under `exceljs@4.4.0`; retains the CommonJS v4 API |

Maintainer references: [CSV changelog](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md),
[Express security release](https://expressjs.com/en/blog/2026-08-31-security-releases/),
[deepmerge 8.0.2](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.2),
[mysql2 3.24.4](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.4),
[UUID 11.1.1](https://github.com/uuidjs/uuid/releases/tag/v11.1.1).

The scoped overrides are temporary upstream-compatibility decisions, not blanket
major upgrades. Revisit them whenever their parent version changes. In particular,
deepmerge 8 changes Map/circular-object behavior; the tested Prisma configuration
uses ordinary configuration objects. Validate/generate/migrate/diff/build were
rerun. Do not install Prisma's prerelease CLI or force audit-suggested framework
downgrades to clear an audit report.

## Reproducible installation

Use Node 22.22.3 and **npm 11.19.1**. npm 11.6.2 was observed retaining vulnerable
workspace dependencies despite the root overrides. The newer npm propagates
overrides across workspace links; see the [upstream fix](https://github.com/npm/cli/pull/9671).
The root engine/package-manager declarations, Docker image, and CI agree on the
tested version. The user's global Node/npm installation was not changed.

After selecting Node 22 and npm 11.19.1:

```bash
npm ci
npm run test:dependencies
npm audit
npm audit --omit=dev
```

The checked-in lockfile was refreshed with the fixed npm, then verified through
a clean `npm ci`. The dependency tests check actual parent-to-child resolution,
all locked copies of the overrides, and ExcelJS's CommonJS UUID API, not merely
manifest declarations. CI now includes these tests and a full npm audit.

## Import protections and regression coverage

Both CSV and XLSX HTTP routes share bounded Multer options: one file, 2 MiB,
one flat `merchantId` field, 64-byte field names, and 256-byte field values.
Nested fields and array indices are disabled. The normal preview/confirmation/
transactional commit sequence is unchanged.

CSV header aliases now use an own-property lookup: a header named `constructor`
must not resolve to an inherited Object function. The parser regression checks
`constructor` and `__proto__` without mutating Object.prototype. Eight real
Nest/Multer HTTP tests cover valid uploads, the exact file-size boundary,
oversized files, nested/large-index fields, duplicate fields/files, bounded text
metadata, and recovery after an aborted upload.

## Verification performed

- Full `npm audit` and `npm audit --omit=dev`: **0 known vulnerabilities** each.
  Both build and runtime Docker installs also reported zero.
- 74 API tests across 9 files; 20 PostgreSQL integration tests across 2 files,
  none skipped; 6 dependency-resolution tests and 6 deployment-config tests.
- Lint, typecheck, build; Prisma validate, generate, four migrations, migration
  status, and schema diff all passed on disposable local PostgreSQL 18.6.
  Integration fixture cleanup left all 13 application tables empty before HTTP
  smoke fixtures were created.
- Built `achaaqui-api:security-review-20260911-01` for `linux/amd64`, non-root.
  Verified the five fixed runtime versions and absence of application env files.
  This local image supersedes `achaaqui-api:cloud-run-review-20260911-01`.
- Production-image HTTP: health/readiness/catalog 200, Swagger/OpenAPI 404,
  missing admin key 401, valid-key reads 200, allowlisted CORS, CSV/XLSX template
  downloads and unmatched-product blocked previews/cancellation, and nested
  multipart rejection all passed. No smoke import was committed; service-level
  integration tests separately exercised committed CSV/XLSX imports and history.
- Database-outage liveness 200/readiness 503 and shutdown without OOM/forced kill
  passed. Removed only labeled temporary API/database containers, their network,
  and tmpfs test data. Existing PostgreSQL container/volume metadata and local
  `.env`/`.env.neon` hashes were unchanged. Neon was not contacted.

This is an npm advisory result at the time of testing, not proof of absence of
all vulnerabilities. Some upstream transitive deprecation warnings remain. No
container OS vulnerability scan, Cloud Run-to-Neon load test, worst-case XLSX
concurrency benchmark, public authorization review, or backup recovery test was
performed in this package slice. The existing billing, IAM, secrets, public-auth,
and exact-artifact deployment gates in [cloud-run-api.md](cloud-run-api.md) remain.
