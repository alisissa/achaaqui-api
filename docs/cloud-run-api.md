# First Cloud Run API deployment — review candidate

Historical private-first preparation. The owner subsequently approved the public
API and existing Swagger on 11 September 2026. See the
[current public API release](public-api-2026-09-11.md). The private template and
its offline tests are not a current-state export and must not be reapplied blindly.

Prepared 11 September 2026. This is local configuration, not deployment approval.
No GCP resources, secrets, IAM bindings, images in Artifact Registry, or DNS records
are created by these files. The admin, mobile, and Firebase homepage are unchanged.

## Exact proposed target

| Setting | Candidate |
| --- | --- |
| Operator account | `alisissa@gmail.com` |
| Project | `achaaqui-web`, number `361472566212` |
| Region / service | `us-east4` / `achaaqui-api` |
| Runtime identity | `achaaqui-api@achaaqui-web.iam.gserviceaccount.com` |
| Image | `us-east4-docker.pkg.dev/achaaqui-web/achaaqui/api@sha256:<approved digest>` |
| First access | IAM-authenticated testing via the generated `run.app` URL; no anonymous invokers |
| Compute | 1 vCPU, 512 MiB, request-based billing, startup CPU boost off |
| Scaling | Minimum 0, maximum 1 at both service and revision levels |
| Requests | Concurrency 4, timeout 60 seconds |
| Database | Existing Neon PostgreSQL 18 database; pooled TLS URL for runtime |
| Per-process pool | Maximum 5 connections, 10-second connect/acquire and idle timeouts |
| Health | Startup `/v1/readiness`; database-independent liveness `/v1/health` |

The JSON [service template](../deploy/cloud-run/api-service.template.json) uses
the Cloud Run v1 service structure (JSON is also valid YAML). The image digest and
three secret versions are intentionally invalid placeholders. Replace them in a
reviewed release copy; never fill them with secret values or use `latest`.
The template's 100% traffic setting is for the first, absent service only. Do not
apply it blindly to an existing service or treat it as a gradual rollout.

`ingress=all` permits the owner's external authenticated test request to reach
Google's front end; it does not grant invocation permission. IAM checking stays
enabled. Inspect project/service IAM and confirm there are no effective
`allUsers`/`allAuthenticatedUsers` invocation grants before deployment. Replacing
a service manifest does not remove existing IAM grants. Grant only the approved
tester service-level `roles/run.invoker` if needed. The current application bearer
key is still required for `/v1/admin/*` in addition to Cloud Run authentication.
See [IAM access](https://docs.cloud.google.com/run/docs/securing/managing-access).

## Cost boundary

This deliberately avoids Cloud SQL, a VPC connector, load balancer, always-on
instances, and a Cloud Build pipeline for the first test. Build the initial image
locally for `linux/amd64`; an image push and deployment require separate approval.

Scale-to-zero trades idle cost for cold starts. The one-instance setting reduces
capacity and availability; it is not a euro spending cap and can be briefly
exceeded. Tagged/replacement revisions also require care. Check both Google Cloud
usage and Neon's separate plan/usage. Image storage, builds if introduced later,
logs, secrets, and cross-cloud data transfer can have their own costs. Do not
promise a fixed monthly bill from these settings.

Before any deployment, recheck the EUR 20 alert budget (EUR 5/10/20 thresholds)
and the `Cloud Run Pausing` spend cap. The 11 September 14:48 Europe/Madrid user
screenshot confirmed monthly EUR 20, project `AchaAqui`, service `Cloud Run`,
and status `Configured`. This verifies configuration, not triggered enforcement;
the public Budgets API readback verified only the separate alert budget. Recheck
after scope/billing changes or before a later rollout. Alerts alone do not stop
charges, and spend-cap enforcement is not instantaneous. Verify current pricing/usage; no
paid Neon upgrade or billing-plan change is authorized here. Sources:
[request-based billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings),
[maximum-instance limitations](https://docs.cloud.google.com/run/docs/configuring/max-instances),
[spend-cap limits and status](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## Secrets and database access

Create these only after approving the exact secret/IAM changes:

| Proposed Secret Manager name | Runtime variable | Content |
| --- | --- | --- |
| `achaaqui-api-database-url` | `DATABASE_URL` | Verified Neon pooled URL with `sslmode=verify-full` for the `pg` driver |
| `achaaqui-api-admin-key` | `ADMIN_API_KEY` | New random API-only secret, at least 32 characters |
| `achaaqui-api-analytics-key` | `ANALYTICS_HASH_KEY` | Separate random HMAC secret, at least 32 characters |

Reference explicit numeric secret versions. Give the API runtime identity
`roles/secretmanager.secretAccessor` on these individual secrets only, not the
whole project. Do not use a service-account key file or the default compute
identity. The user-approved cleanup removed the default compute account's
project `roles/editor` grant on 11 September at 12:51:48 UTC. Fresh policy readback
matched exactly the original policy minus that one membership; Owner, other
bindings, and audit settings were preserved. The account was not deleted or
disabled. See the workspace `AGENTS.md` for bounded dependency checks and etags.
Do not regrant Editor for deployment; use the dedicated runtime identity.
See [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

Read credentials only from the ignored local source when preparing an approved
secret upload. Never echo them, pass them as shell argument values, log them, put
them in a build argument, or embed them in this template. Do not edit `.env` or
`.env.neon` just to build an image. Runtime certificate and hostname verification
must stay enabled; do not use `rejectUnauthorized=false` or
`NODE_TLS_REJECT_UNAUTHORIZED=0`.

Prisma 7 uses `PrismaPg`/`pg` pool options, not Prisma-engine URL pool parameters.
`DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT_MS`, and
`DATABASE_IDLE_TIMEOUT_MS` are validated and passed to the adapter. Local defaults
are 10 connections and 10-second connection/idle timeouts; the Cloud Run template
selects 5 connections. An idle timer is not a guarantee that Neon suspends while
Cloud Run's idle CPU is throttled. See [driver pool behavior](https://node-postgres.com/apis/pool).

The existing four migrations were already applied to Neon in the prior approved
step. This first deployment should not run a migration or seed. Future schema
releases must use a reviewed one-off migration step, the **direct** Neon endpoint,
and backup/restore preparation. `prisma.config.ts` reads `DATABASE_URL`, not
`DIRECT_URL`; explicitly supply the direct URL to that process. The API image
must never receive the direct migration secret or run migrations at startup.
Current Neon credentials have not yet been split into a restricted application
role and a DDL migration role; resolve that before accepting real merchant data.

## Local verification and release gates

```bash
npm run test:deployment
npm run test:dependencies
npm audit
npm audit --omit=dev
npm run lint
npm run typecheck
npm test
npm run build
docker build --platform linux/amd64 --tag achaaqui-api:review .
```

The Docker context allowlists only required manifests/source/schema, excluding
nested environment files and host-generated output. Prisma client generation uses
an inert build-only URL and needs no database connection. Test the image locally
against a separate disposable PostgreSQL 18 database, never against Neon or the
preserved local volume. Run integration tests only with explicitly isolated
`DATABASE_URL` and `TEST_DATABASE_URL`. Offline config tests validate our intended
settings; they do not prove Google has accepted the manifest or checked live IAM.

### Initial verification performed on 11 September

The original image and audit findings below are historical. The subsequent
[dependency remediation](dependency-remediation.md) passed 74 API tests,
20 isolated integration tests, 12 offline checks, and fresh image smoke tests;
full and production-only npm audits report zero known vulnerabilities. Use the
new local `achaaqui-api:security-review-20260911-01` candidate, not the earlier
image below. This still does not authorize a push or deployment.

- Passed 65 API unit tests, 20 isolated PostgreSQL 18.6 integration tests, and
  6 offline deployment-configuration tests; lint, typecheck, build, and formatting
  checks passed. The installed gcloud YAML loader and Cloud Run v1 message decoder
  also accepted the template structure offline; no Google API validation was run.
- Built local image `achaaqui-api:cloud-run-review-20260911-01` for `linux/amd64`
  without database credentials. Confirmed non-root execution, absence of application
  environment files, and production-mode health/readiness/catalog HTTP 200, disabled
  Swagger/OpenAPI HTTP 404, missing admin key HTTP 401, valid-key read HTTP 200,
  and explicit CORS behavior against disposable local PostgreSQL only.
- A separate outage check returned liveness 200/readiness 503 after stopping the
  temporary database. Temporary containers stopped without OOM/forced kill and
  were removed with their temporary networks/data. An idle memory sample was about
  197 MiB of 512 MiB; this was not a file-upload or concurrency load benchmark.
- The first packaging check incorrectly assumed `npm ci --omit=dev` would exclude
  the Prisma CLI. npm installs Prisma 7.10.0 through `@prisma/client`'s peer
  dependency. It is present in this image, though startup runs only `dist/main.js`.
  Do not claim a tooling-free image or remove peer dependencies without testing.
- The initial `npm audit --omit=dev` reported **11 affected packages: 8 high, 3 moderate**.
  Findings include Multer/Nest dependency chains, CSV parsing, Prisma tooling
  dependencies, and ExcelJS/UUID. This is not 11 independently proven exploitable
  application defects. The subsequent approved remediation fixes these chains
  without Nest/Prisma major downgrades; see the linked current verification above.
- No Neon connection, GCP resource/IAM/secret change, registry push, deployment,
  DNS change, commit, or Git push occurred. Existing local environment files and
  the preserved PostgreSQL container/volume remained unchanged.

Before rollout:

1. Review the code diff, dependency advisories, exact Git revision, and immutable
   image digest. Do not deploy a dirty worktree without a separately reviewed
   release artifact; do not silently commit or push it.
2. Approve the exact account/project/region/service, secret versions and grants,
   image push, private invocation policy, costs, and any IAM cleanup separately.
   Confirm the service does not already exist before using the initial template.
3. Keep `TRUST_PROXY_HOPS=0` for the bounded private test. Client-IP analytics and
   rate limiting will see the proxy address. Verify the actual forwarding chain
   and spoofing behavior before selecting a trusted hop count for public access;
   CORS is not authorization. No wildcard browser origins.
4. After approved private deployment, require unauthenticated requests to be
   denied by Google, then test authenticated health/readiness and empty catalog
   reads. Swagger/OpenAPI must return 404. Administrative reads without the app
   key must be denied even for an IAM-authenticated caller. Supply the Google ID
   token in `X-Serverless-Authorization` if the application bearer key needs the
   `Authorization` header; never print either token.
5. Compare deployed image, runtime identity, limits, secret version references,
   traffic, and effective IAM to the approved copy. Record startup time, errors,
   memory, and billing. Do not attach `api.achaaqui.com` or change the homepage's
   API URL in this slice.
6. Use isolated staging data for write/load tests and backup restoration before
   real merchant operations. Exercise worst-case 500-row/2-MB files at concurrency
   4; 512 MiB is a starting configuration, not a measured peak-load guarantee.
   A Cloud Run request timeout does not ensure cancellation of work or rollback:
   inspect import status before retrying, preserving idempotency.

The private API test is not a customer launch. Public merchant/admin access still
requires Firebase auth, tenant enforcement, cross-tenant authorization tests, and
actor IDs. No admin deployment is included. Public catalog exposure also needs a
separate review of all reachable routes and abuse controls.

Rollback later means routing to a known-good compatible revision, with its secret
versions still available. For the first service there is no previous revision:
agree an explicit stop/disable procedure before rollout. Never reset the database
or apply destructive reverse migrations as an application rollback.

References: [Cloud Run service schema](https://docs.cloud.google.com/run/docs/reference/yaml/v1),
[container health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks),
[service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).
