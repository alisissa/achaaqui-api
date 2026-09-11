import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const require = createRequire(new URL("package.json", root));
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const lock = JSON.parse(
  await readFile(new URL("package-lock.json", root), "utf8"),
);

const fixes = [
  ["@nestjs/platform-express", "multer", "2.3.0"],
  ["@prisma/config", "deepmerge-ts", "8.0.2"],
  ["prisma", "mysql2", "3.24.4"],
  ["exceljs", "uuid", "11.1.1"],
];

for (const [parent, child, expected] of fixes) {
  test(`${parent} resolves the reviewed ${child} security override`, async () => {
    const fromParent = createRequire(
      require.resolve(parent === "prisma" ? "prisma/package.json" : parent),
    );
    const location = fromParent.resolve(child);
    // Check the loaded module's own package metadata without relying on a
    // package.json export (some packages intentionally do not export it).
    let directory = new URL(".", pathToFileURL(location));
    while (true) {
      try {
        const pkg = JSON.parse(
          await readFile(new URL("package.json", directory), "utf8"),
        );
        if (pkg.name === child) {
          assert.equal(pkg.version, expected);
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const next = new URL("../", directory);
      assert.notEqual(
        next.href,
        directory.href,
        `Missing metadata for ${child}`,
      );
      directory = next;
    }
    const copies = Object.entries(lock.packages).filter(
      ([key]) =>
        key.endsWith(`/node_modules/${child}`) ||
        key === `node_modules/${child}`,
    );
    assert.ok(copies.length > 0);
    for (const [, pkg] of copies) assert.equal(pkg.version, expected);
  });
}

test("CSV parser and npm toolchain remain pinned to reviewed versions", async () => {
  assert.equal(lock.packages["node_modules/csv-parse"].version, "7.0.2");
  assert.equal(manifest.packageManager, "npm@11.19.1");
  assert.equal(manifest.engines.npm, ">=11.19.1 <12");
  assert.match(
    await readFile(new URL("Dockerfile", root), "utf8"),
    /npm@11\.19\.1/,
  );
  assert.match(
    await readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
    /npm@11\.19\.1/,
  );
});

test("ExcelJS can still load the CommonJS UUID v4 API", () => {
  const fromExcel = createRequire(require.resolve("exceljs"));
  const { v4, validate, version } = fromExcel("uuid");
  const id = v4();
  assert.ok(validate(id));
  assert.equal(version(id), 4);
});
