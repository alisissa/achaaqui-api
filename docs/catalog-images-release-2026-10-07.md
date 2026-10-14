# Catalog photo/category release — 7 October 2026

## Authorization and result

Ali explicitly approved the private image bucket, prefix-scoped API permissions,
and API/admin deployment. This was not approval for migrations, password changes,
invented prices, or App Store submission. Separate dirty worktrees were preserved;
no Git commit or push was performed.

Project `achaaqui-web`, account `alisissa@gmail.com`, named configuration
`achaaqui`, region `us-east4` were used explicitly throughout.

| Service | Previous revision | New revision (100% traffic) |
| --- | --- | --- |
| API | achaaqui-api-00013-6xv | achaaqui-api-00014-2j8 |
| Admin | achaaqui-admin-00008-p4s | achaaqui-admin-00009-pbr |

Registry: `us-east4-docker.pkg.dev/achaaqui-web/achaaqui`.
Tags for both `api` and `admin`: `catalog-photos-20261007`.

API index: `sha256:09114c28619327ede4a25b20881407c349e9739e83344484fb6e838295525de8`.
Resolved linux/amd64: `sha256:107e4f18d14a66da470e5bf2e3e8f0ad2f2c0b859adb0e4fb345c95c554babb4`.

Admin index: `sha256:55786fb70b9b1f83e17ee73168d90f0d4f5afa18d1deca611090016a7777e2e1`.
Resolved linux/amd64: `sha256:9148359e1f7cdeac8b7fb7ec49da69c42993a2cdecd1b20ec7d492a2ec4b05c8`.

Registry index bytes and Cloud Run resolved platform digests were independently
matched. Deployed from reviewed local dirty source, not claimed to match HEAD.
Per-file source manifests and detailed evidence are in
`/private/tmp/achaaqui-catalog-photo-release-20261007.aFJ1h0` (temporary evidence).

## Storage and configuration

Created `achaaqui-web-catalog-images`, Standard storage, US-EAST4, uniform bucket
access and public access prevention enforced. Existing bucket policy bindings
were preserved. Added `roles/storage.objectCreator` and
`roles/storage.objectViewer` for the existing API runtime identity
`achaaqui-api@achaaqui-web.iam.gserviceaccount.com`, each conditioned on:

```text
resource.name.startsWith('projects/_/buckets/achaaqui-web-catalog-images/objects/catalog/products/')
```

No public grant or service-account key. The verifier initially rejected reordered
JSON fields; a read-only semantic comparison confirmed the complete intended
policy without another mutation.

API environment additions only:

- `CATALOG_IMAGE_BUCKET=achaaqui-web-catalog-images`
- `CATALOG_IMAGE_PUBLIC_ORIGIN=https://api.achaaqui.com`

All other runtime/template/service settings were compared and preserved, including
API service min 1/max 1, admin max 1, identities, secret references, ingress and
service IAM. Billing enabled and existing EUR 20 alert budget read back; this is
not a hard spending cap. No fresh console verification of Cloud Run Pausing.

## Verification

- Local implementation checks recorded 181 API tests, 129 isolated PostgreSQL
  integration tests and 32 admin tests, plus lint/typecheck/build.
- Fresh production dependency audits: zero known findings for API and admin.
- 31 isolated packaged smoke checks, non-root images, no environment files,
  Sharp runtime processing, auth denials and admin static assets.
- 14 live HTTP checks: health/readiness/catalog/OpenAPI, new admin route denials,
  invalid/missing image handling, direct anonymous GCS access denied, login/assets.
- New revisions ready with 100% traffic; no error/HTTP 5xx entries in the checked
  startup window (not an ongoing monitoring guarantee).
- Read-only production DB comparison: 16 nonvolatile tables unchanged, 12
  existing migrations, 37 total offers including 2 unpriced. No schema/data write.
- Temporary smoke containers/network were cleaned up; preserved databases were
  not used for tests. Registry images and the approved bucket remain.

## Explicit remaining gates

Browser control failed again with `Sky Computer Use native pipe startup failed`.
No signed-in production image upload, API-runtime storage round trip, public
read of a newly committed photo, or rendered admin QA was completed. Policy
readback is not a substitute for these checks.

Catalog completion remains separate: no product photos or `perfumes` category
were created by this deployment, and it does not complete five products per
merchant. Use the authenticated editor and existing validated workflows; do not
attach images by direct SQL or bypass explicit confirmation.

Mobile favorites layout/category changes require a later native build. No Apple
or Google submission occurred in this rollout.

## Recovery

Previous service JSON and image references are saved in the temporary evidence
directory. If a regression is confirmed, explicitly approve routing to the prior
revision or a scoped rollback preserving newer settings. Do not delete the bucket
or object data, rotate credentials, reset databases, or restore an entire stale
service policy as routine rollback.
