import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./api-service.template.json", import.meta.url),
  "utf8",
);
const service = JSON.parse(source);
const revision = service.spec.template;
const container = revision.spec.containers[0];
const env = Object.fromEntries(
  container.env.map((entry) => [entry.name, entry]),
);

test("targets only the agreed AchaAqui API project, region, and identity", () => {
  assert.equal(service.apiVersion, "serving.knative.dev/v1");
  assert.equal(service.kind, "Service");
  assert.equal(service.metadata.name, "achaaqui-api");
  assert.equal(service.metadata.namespace, "361472566212");
  assert.equal(
    service.metadata.labels["cloud.googleapis.com/location"],
    "us-east4",
  );
  assert.equal(
    revision.spec.serviceAccountName,
    "achaaqui-api@achaaqui-web.iam.gserviceaccount.com",
  );
  assert.equal(revision.spec.containers.length, 1);
});

test("keeps IAM invocation checks enabled without adding public IAM bindings", () => {
  assert.equal(
    service.metadata.annotations["run.googleapis.com/invoker-iam-disabled"],
    "false",
  );
  assert.equal(
    service.metadata.annotations["run.googleapis.com/ingress"],
    "all",
  );
  assert.doesNotMatch(source, /allUsers|allAuthenticatedUsers|iamPolicy/);
});

test("uses explicit service and revision cost controls", () => {
  assert.equal(
    service.metadata.annotations["run.googleapis.com/minScale"],
    "0",
  );
  assert.equal(
    service.metadata.annotations["run.googleapis.com/maxScale"],
    "1",
  );
  assert.equal(
    revision.metadata.annotations["autoscaling.knative.dev/minScale"],
    "0",
  );
  assert.equal(
    revision.metadata.annotations["autoscaling.knative.dev/maxScale"],
    "1",
  );
  assert.equal(
    revision.metadata.annotations["run.googleapis.com/cpu-throttling"],
    "true",
  );
  assert.equal(
    revision.metadata.annotations["run.googleapis.com/startup-cpu-boost"],
    "false",
  );
  assert.deepEqual(container.resources.limits, { cpu: "1", memory: "512Mi" });
  assert.equal(revision.spec.containerConcurrency, 4);
  assert.equal(revision.spec.timeoutSeconds, 60);
  assert.doesNotMatch(
    source,
    /vpc-access|cloudsql-instances|network-interfaces/,
  );
});

test("requires an immutable image and explicit secret-version review before use", () => {
  assert.equal(
    container.image,
    "us-east4-docker.pkg.dev/achaaqui-web/achaaqui/api@sha256:__IMAGE_SHA256__",
  );
  const expected = {
    DATABASE_URL: ["achaaqui-api-database-url", "__DATABASE_SECRET_VERSION__"],
    ANALYTICS_HASH_KEY: [
      "achaaqui-api-analytics-key",
      "__ANALYTICS_SECRET_VERSION__",
    ],
  };
  for (const [key, [name, version]] of Object.entries(expected)) {
    assert.equal(env[key].value, undefined);
    assert.deepEqual(env[key].valueFrom.secretKeyRef, { name, key: version });
  }
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\/|:latest|"key":\s*"latest"/);
  assert.equal(env.DIRECT_URL, undefined);
  assert.equal(env.ADMIN_API_KEY, undefined);
  assert.equal(env.ADMIN_AUTH_MODE.value, "firebase");
  assert.equal(env.FIREBASE_PROJECT_ID.value, "achaaqui-web");
  assert.equal(container.command, undefined);
  assert.equal(container.args, undefined);
});

test("uses bounded API settings and lets Cloud Run supply PORT", () => {
  assert.equal(
    container.env.length,
    new Set(container.env.map((entry) => entry.name)).size,
  );
  assert.equal(env.NODE_ENV.value, "production");
  assert.equal(env.SWAGGER_ENABLED.value, "false");
  assert.equal(env.TRUST_PROXY_HOPS.value, "0");
  assert.equal(
    env.CORS_ORIGINS.value,
    "https://achaaqui.com,https://www.achaaqui.com",
  );
  assert.equal(env.DATABASE_POOL_MAX.value, "5");
  assert.equal(env.DATABASE_CONNECTION_TIMEOUT_MS.value, "10000");
  assert.equal(env.DATABASE_IDLE_TIMEOUT_MS.value, "10000");
  assert.equal(env.IMPORT_MAX_ROWS.value, "500");
  assert.equal(env.IMPORT_MAX_FILE_BYTES.value, "2097152");
  assert.equal(env.PORT, undefined);
  assert.deepEqual(container.ports, [{ name: "http1", containerPort: 8080 }]);
});

test("checks database readiness only at startup, not on every liveness probe", () => {
  assert.deepEqual(container.startupProbe.httpGet, {
    path: "/v1/readiness",
    port: 8080,
  });
  assert.equal(
    container.startupProbe.periodSeconds *
      container.startupProbe.failureThreshold,
    120,
  );
  assert.deepEqual(container.livenessProbe.httpGet, {
    path: "/v1/health",
    port: 8080,
  });
  assert.equal(container.livenessProbe.periodSeconds, 30);
  assert.equal(container.readinessProbe, undefined);
});
