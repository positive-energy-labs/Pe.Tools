import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
// A `$schema` key and its string value, plain or inside an escaped JSON string (`\"$schema\": \"…\"`).
const schemaValue = /\\?"\$schema\\?"\s*:\s*\\?"([^"\\]*)/g;
const libraryPath = /^\/schemas\/settings\/[^/]+\/[^/]+\.json$/;

/**
 * Homes freeze shape 6: a stored library `$schema` is `/schemas/settings/<module>/<root>.json`, no
 * scheme and no host. A value that names no settings library (a JSON Schema meta-schema) is not counted.
 * Mutant: put `http://127.0.0.1:5180` back in front of one fixture's value.
 */
test("every checked-in JSON file stores a library $schema as its path", () => {
  const census = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.json"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .trim()
    .split(/\r?\n/)
    .filter((file) => existsSync(resolve(root, file)))
    .flatMap((file) =>
      [...readFileSync(resolve(root, file), "utf8").matchAll(schemaValue)]
        .map((match) => match[1]!)
        .filter((value) => value.includes("/schemas/settings/"))
        .map((value) => ({ file, value })),
    );
  expect(census.filter(({ value }) => !libraryPath.test(value))).toEqual([]);
  // The known set, so an empty or narrowed scan fails. A new fixture updates this count.
  expect(new Set(census.map(({ file }) => file)).size).toBe(11);
  expect(census.map(({ file }) => file)).toContain(
    "ts/apps/host/tests/fixtures/families-live-preview-20261102.json",
  );
});
