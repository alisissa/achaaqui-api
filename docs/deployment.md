# Deployment release procedure

This document prepares a release; it does not authorize one. Cloud resources,
billing, domains, and production changes still require explicit approval.

The selected API-only target and private first-deployment settings are in
[cloud-run-api.md](cloud-run-api.md). Its Neon setup and approval gates take
precedence over this generic full-release sequence. Admin deployment is separate.

## Images

Build the API runtime image from the default target:

```bash
docker build --platform linux/amd64 --tag achaaqui-api:local .
```

Build the separate migration image from the same source revision:

```bash
docker build --target migrations --tag achaaqui-api-migrations:local .
```

The admin repository has its own standalone Next.js image:

```bash
docker build --tag achaaqui-admin:local .
```

Both services listen on Cloud Run's `PORT` value and run as non-root users. The
API image uses `npm ci --omit=dev`, but Prisma CLI is still installed through
`@prisma/client`'s peer dependency. It is covered by the security overrides and
audit; API startup does not execute migrations. The migration image includes
the CLI intentionally and must not receive public traffic. Use the pinned npm
11.19.1 toolchain and review [dependency remediation](dependency-remediation.md).

## Release order

1. Run CI against the exact revision being released.
2. Take a database backup and record its identifier.
3. Run the migration image once with the production `DATABASE_URL` supplied by
   Secret Manager. It executes `prisma migrate deploy`; migrations never run in
   API startup.
4. Verify migration status before changing service traffic.
5. Deploy the API with Swagger disabled and explicit CORS/proxy settings.
6. Smoke-test health, readiness, catalog reads, and a non-committing import
   preview.
7. Only in a separately approved admin release, after the Firebase/tenant-auth
   gates: deploy the admin and verify authenticated authorization and read-only pages.
8. Move traffic gradually and monitor errors before enabling merchant uploads.

If migration execution is ambiguous, inspect the Prisma migration table and
database state before retrying. Never use `prisma migrate dev` against a hosted
environment.

## Required runtime configuration

API: `DATABASE_URL`, `CORS_ORIGINS`, `ADMIN_API_KEY`, `ANALYTICS_HASH_KEY`,
`SWAGGER_ENABLED=false`, and `TRUST_PROXY_HOPS` set for the verified Cloud Run
proxy chain. Bound the Prisma/pg pool with `DATABASE_POOL_MAX`,
`DATABASE_CONNECTION_TIMEOUT_MS`, and `DATABASE_IDLE_TIMEOUT_MS`.

Admin: `ADMIN_API_URL`, `ADMIN_API_KEY`, `ADMIN_USERNAME`, a non-placeholder
16+ character `ADMIN_PASSWORD`, and a distinct non-placeholder 32+ character
`ADMIN_SESSION_SECRET`.

Before the first billable resource is created, configure a billing budget and
alerts. Before merchant data is accepted, perform and verify one backup restore.
