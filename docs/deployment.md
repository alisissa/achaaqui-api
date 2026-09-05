# Deployment release procedure

This document prepares a release; it does not authorize one. Cloud resources,
billing, domains, and production changes still require explicit approval.

## Images

Build the API runtime image from the default target:

```bash
docker build --tag achaaqui-api:local .
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
API image contains production dependencies only. The migration image includes
the Prisma CLI intentionally and must not receive public traffic.

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
7. Deploy the admin and verify login throttling plus read-only pages.
8. Move traffic gradually and monitor errors before enabling merchant uploads.

If migration execution is ambiguous, inspect the Prisma migration table and
database state before retrying. Never use `prisma migrate dev` against a hosted
environment.

## Required runtime configuration

API: `DATABASE_URL`, `CORS_ORIGINS`, `ADMIN_API_KEY`, `ANALYTICS_HASH_KEY`,
`SWAGGER_ENABLED=false`, and `TRUST_PROXY_HOPS` set for the verified Cloud Run
proxy chain.

Admin: `ADMIN_API_URL`, `ADMIN_API_KEY`, `ADMIN_USERNAME`, a non-placeholder
16+ character `ADMIN_PASSWORD`, and a distinct non-placeholder 32+ character
`ADMIN_SESSION_SECRET`.

Before the first billable resource is created, configure a billing budget and
alerts. Before merchant data is accepted, perform and verify one backup restore.
