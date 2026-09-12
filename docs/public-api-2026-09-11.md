# Public API and Swagger — 11 September 2026

The owner explicitly requested public API access and Swagger for
`api.achaaqui.com`. This slice does not deploy the admin panel or change its
authentication requirements. No Namecheap records were changed by the agent.

## Deployed state

- Account `alisissa@gmail.com`, named gcloud configuration `achaaqui`, project
  `achaaqui-web` (361472566212), service `achaaqui-api`, region `us-east4`.
- Revision `achaaqui-api-00002-ldc` became ready at
  `2026-09-11T18:08:40.597502Z` and receives 100% of service traffic.
- Only `SWAGGER_ENABLED=false -> true` and the service's
  `invokerIamDisabled=false -> true` were requested in an etag-protected patch
  after a server-side dry run. The service now accepts anonymous requests,
  including its existing `run.app` URLs. No public IAM role binding was added;
  the service policy still has no explicit bindings (`ACAB`).
- The immutable image is unchanged:
  `us-east4-docker.pkg.dev/achaaqui-web/achaaqui/api@sha256:95613bd285fd649e52b0156bce56c2df1f951574b50458b57436c1415a96aa4d`,
  built from commit `622306ea61162810a70707cdfceb2e3d6b96fe2f`.
- Existing dedicated API identity and all three version-1 secret references are
  unchanged. The administrative bearer key remains required for `/v1/admin/*`.
  Public documentation contains the security scheme, never the key itself.
- Cost settings remain min 0/max 1 at service/revision levels, request-based
  billing, startup CPU boost off, 1 vCPU/512 MiB, concurrency 4, timeout 60s, and
  a five-connection PostgreSQL pool. The EUR 20 alert budget and EUR 5/10/20
  thresholds were read back unchanged. The previously verified Cloud Run spend
  cap was not modified or enforcement-tested. These are not an all-services
  EUR 20 spending guarantee.

## Firebase Hosting routing

Created only the separate `achaaqui-api` Hosting site in `achaaqui-web`:

- Working URL: <https://achaaqui-api.web.app>.
- `/` responds with a temporary 302 redirect to `/v1/docs/`.
- `/v1/*` paths reach the existing Cloud Run API; no new backend is deployed.
- REST-format configuration: `deploy/firebase/api-serving-config.json`.
  This is a Firebase `ServingConfig`, not a CLI `firebase.json` file.
- Version `sites/achaaqui-api/versions/f1524a6e08ab8534`, release
  `sites/achaaqui-api/releases/1789150247245000`, published at
  `2026-09-11T18:10:47.245Z`. It contains routing only, no uploaded static files.
- No pinned revision tag, extra load balancer, build pipeline, homepage release,
  admin site, billing-plan change, or new secret was introduced.
- Successful API and Swagger responses were observed with
  `Cache-Control: private, no-store`. Firebase did not append the configured
  headers to 401 responses; those had no explicit public caching directive.
  Anonymous -> authenticated -> anonymous administrative reads returned
  401 -> 200 -> 401, with private/no-store on the authorized response.

The existing homepage Hosting site and its `@`/`www` records remain separate.
Homepage HTTPS returned 200 and `www` redirected to the apex after this rollout.

## Pending owner DNS step

Registered `api.achaaqui.com` on the new API Hosting site at
`2026-09-11T18:11:50.105017915Z`. Firebase's required DNS update is:

| Type | Namecheap host | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `api` | `achaaqui-api.web.app` | Automatic |

Do not change the existing `@` or `www` records, or invent another A/TXT record.
Initial state is `HOST_UNHOSTED`, `OWNERSHIP_MISSING`, `CERT_VALIDATING`.
Re-read Firebase and public DNS after the owner saves the record. Do not claim
the custom domain is live until ownership, host routing, and HTTPS verify.
Firebase also exposes optional ACME migration challenges; the selected new-domain
flow points DNS first and lets Hosting handle HTTP certificate validation.

## Verification and limitations

- Passed 74 API unit tests, lint, typecheck, production build, six historical
  private-template tests, and three new offline Firebase routing tests. The first
  unit run hit a sandbox loopback restriction; rerunning with loopback permission
  passed all tests. No application source or dependency versions changed.
- Live direct API: anonymous health, readiness, products, categories, merchants,
  Swagger HTML, OpenAPI JSON, and all four Swagger CSS/JS assets returned 200.
- OpenAPI exposes 26 paths, including 17 administrative paths. All 21 documented
  administrative operations declared the bearer scheme and each rejected both
  missing and invalid keys: 42 expected 401 responses. All documented non-admin
  operations use GET; product search GETs can still write search analytics.
- Firebase routing: root redirect, Swagger/OpenAPI, health, products, and the
  protected merchant read were verified. A valid cloud key was used in memory
  for one merchant-list read; no key was printed or written to source files.
- No valid-key mutation, import, seed, migration, reset, database load test, or
  integration-suite run against a live database occurred. The unchanged release's
  prior 20 isolated PostgreSQL 18 integration tests were not rerun in this slice.
- Browser automation was unavailable, so Swagger HTML/assets were HTTP-verified,
  not visually inspected. The pre-existing Swagger title remains `Catalog API`.
- `TRUST_PROXY_HOPS=0` remains conservative: rate limits and IP-derived analytics
  use a proxy address, not verified individual client IPs. The existing 120/min
  per-handler in-process limiter is not a distributed abuse or spend guarantee;
  Swagger middleware does not receive Nest controller throttling. Review trusted
  forwarding and load/abuse controls before a broader customer launch.
- The current shared key is for owner-operated beta use, not merchant self-service.
  Firebase roles, tenant enforcement, cross-merchant tests, real actor IDs, a
  restricted database runtime role, and restore/load verification remain pending.
- No Git commit/push, admin/mobile edit, local database change, or global gcloud
  account/configuration change was performed.

Run the routing checks with `node --test deploy/firebase/config.test.mjs`.
For a future approved rollback to private access, re-enable the service invoker
check and disable Swagger, verifying no effective public invoker grants exist.
The API Hosting route will then be denied until deliberately reconfigured.
Do not reset Neon, delete secrets, or blindly restore an old whole service/IAM
configuration as a rollback.

References: [Cloud Run public access](https://docs.cloud.google.com/run/docs/authenticating/public),
[Firebase Cloud Run routing](https://firebase.google.com/docs/hosting/cloud-run),
[Hosting REST configuration](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions#ServingConfig),
[custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain).
