# GCP migration plan — functionality first

Functionality plan started 6 September; deployment decisions updated 11 September
2026. This document authorizes no resource or DNS changes. The approved foundation
and Neon schema setup were separate completed steps; see the workspace `AGENTS.md`
for their dated evidence. Existing local PostgreSQL data in
`compras-api_catalog_postgres_data` must remain intact. The current API-only review
candidate and remaining approval gates are in [cloud-run-api.md](cloud-run-api.md).

## First: finish the merchant release boundary

The admin now supports templates, CSV/XLSX import, and individual offer
maintenance. Before public merchant access, implement Firebase sign-in and
NestJS ID-token verification. Issue `platform_admin` or `merchant` roles and a
trusted `merchantId` claim for merchants. Enforce ownership in services and every
database read/write, including template exports, imports, previews, commits,
cancellation, product creation, and history. Test two real authenticated tenants,
expired/revoked tokens, forged claims, and cross-merchant identifiers. Record real
actor IDs. Only privileged server code may set claims. See the official
[Firebase custom-claims guidance](https://firebase.google.com/docs/auth/admin/custom-claims).

The current shared credentials/API key and process-local login throttling are
not the public design. Do not give merchants the key or expose the current admin
unchanged. Decide which shared-product metadata merchants can propose versus
what platform administrators must approve.

Next functionality priorities: merchant profile editing/deactivation, product
images/descriptions, onboarding/invitations, import error downloads and saved
column mappings, then freshness reminders and a full operator activity log.

## Small initial target

| Component | Proposed home | Decision still required |
| --- | --- | --- |
| NestJS API | One private-first Cloud Run service in `us-east4`, project `achaaqui-web` | Review candidate: 0–1 instances, 1 vCPU/512 MiB, concurrency 4, pool 5; deployment approval pending |
| Next.js admin | Separate Cloud Run service | Firebase auth, custom-domain front door, session/CSRF behavior |
| PostgreSQL 18 | Existing Neon Free project in AWS US East (N. Virginia) | Four migrations applied; restricted runtime role, recovery and workload validation remain |
| Runtime secrets | Secret Manager | Separate runtime service accounts and least-privilege grants |
| Container images | Artifact Registry | Repository, retention, build/release identity |
| Public homepage | Existing approved Firebase Hosting launch page | No changes in the API deployment slice; recheck domain state when relevant |
| Product images, later | Cloud Storage | Upload validation, access rules, retention/CDN policy |

The owner selected a cost-first Northern Virginia start: Google `us-east4` for
the API and Neon `aws-us-east-1` for PostgreSQL. This is cross-cloud networking,
not a shared Google region or a guarantee of minimum cost/latency for Brazil and
Paraguay. Cloud SQL and its connectors/private-networking costs are no longer the
initial plan. Use Neon's pooled TLS endpoint for runtime and a separately scoped
direct connection for controlled migrations. Bound application pools and instance
counts together, allowing headroom for revision overlap. Prefer short-lived
deployment credentials; do not change the global gcloud account away from other
workspaces. See the [specific first-deployment plan](cloud-run-api.md).

Keep imports synchronous and bounded at 500 rows/2 MB initially. Load-test
worst-case parsing, memory, transaction duration, connection use, and concurrent
uploads on the chosen Cloud Run resources. Larger jobs can later use durable
background processing when needed; no Kubernetes, Redis, or microservice split
is required for this release.

## Domains and HTTPS: separate approval after functionality

- `achaaqui.com`: approved static public homepage on Firebase Hosting.
- `www.achaaqui.com`: redirect to the apex.
- `admin.achaaqui.com` and `api.achaaqui.com`: later, after auth/staging approval.

Firebase Hosting provisions certificates for connected custom domains. Take the
exact verification and DNS records from the selected project's setup, preserve
mail/other records, and approve the DNS diff before applying it. Existing DNS
ownership/state was not rechecked for this planning task. See
[Firebase custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain).

Do not assume the same front door is automatically suitable for Next.js:
Firebase Hosting's Cloud Run rewrites have a 60-second request limit, and Hosting
forwards only the specially named `__session` cookie. Our current
`achaaqui_admin_session` cookie is incompatible with that rewrite as-is. If
choosing this approach later, implement and test the final Firebase session
design, private/no-store responses, Server Actions origin/CSRF handling, login,
logout, expiration, and uploads. Sources:
[Cloud Run rewrites](https://firebase.google.com/docs/hosting/cloud-run) and
[Hosting cookies/caching](https://firebase.google.com/docs/hosting/manage-cache).

Alternatively, evaluate an external Application Load Balancer for the API/admin
custom domains, with its extra cost/configuration. Cloud Run's built-in domain
mapping remains Preview and is not Google's recommendation for production;
do not make it the default plan. See
[Cloud Run custom-domain options](https://cloud.google.com/run/docs/mapping-custom-domains).

## Rollout gates

1. Confirm project, billing, region, cost estimate, budget alerts, database tier,
   backup retention, availability target, and authorized release identities.
2. Finish authentication/authorization and recheck dependencies on the exact
   release artifact. The 11 September remediation cleared the initial 11-package
   production audit: both full and production-only npm audits now report zero
   known vulnerabilities. Keep npm 11.19.1 and the tested scoped overrides; see
   [dependency remediation](dependency-remediation.md). This does not replace
   application authorization, container OS scanning, or live deployment review.
3. Establish staging with separate secrets/data. Build immutable images with the
   declared Node/npm versions. Configure narrowly scoped CORS, secure cookies,
   explicit trusted proxies, readiness, and Swagger disabled in production.
4. Back up the intended source database and rehearse restore to an isolated
   PostgreSQL target. Decide whether to migrate selected local data or start
   clean; do not migrate demo data or run the seed in production by default.
5. Run `prisma migrate deploy` as a controlled one-off release step, not
   concurrently from every API instance. Validate migrations/constraints and
   restore capability before switching traffic. Never use `migrate reset` or
   delete the local Docker volume.
6. Test private staging end to end: templates, uploads, warnings, commits,
   retries, concurrency, stale edits, remove/restore, two-tenant denials, public
   reads, price history, mobile refresh, and backup recovery. Set retention for
   search analytics/import data and error logs without raw queries or secrets.
7. Approve the preview, exact production services/image revisions, data plan,
   traffic cutover, monitoring, and rollback. Roll back app traffic independently;
   schema/data rollback needs a rehearsed compatible migration or restore plan.
8. Approve the exact DNS records separately. Validate apex/www behavior, API/admin
   TLS, redirects, sessions, CORS, and certificate issuance. Keep the previous
   working target available through the validation window.

Nothing in this plan creates infrastructure or changes the current local runtime.
