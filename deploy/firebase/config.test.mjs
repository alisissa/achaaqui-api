import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync(new URL("./api-serving-config.json", import.meta.url), "utf8"),
);

test("only the API service in the selected region receives requests", () => {
  assert.deepEqual(config.rewrites, [
    { glob: "**", run: { serviceId: "achaaqui-api", region: "us-east4" } },
  ]);
});

test("the root temporarily redirects to Swagger without changing API paths", () => {
  assert.deepEqual(config.redirects, [
    { glob: "/", location: "/v1/docs/", statusCode: 302 },
  ]);
});

test("API responses must not be cached publicly or indexed", () => {
  assert.deepEqual(config.headers, [
    {
      glob: "**",
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  ]);
});
