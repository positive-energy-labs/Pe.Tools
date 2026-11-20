/**
 * ADR 0046: generic code names no product outside declared composition sites.
 * FANS-P4-NAMES-25 freezes existing mentions; counts must fall to zero and never rise.
 * One recorded rise: S2b of the product-declaration run added the `rooms` product folder, which made the
 * name a product name in 18 files of old Rooms code. S9 deletes that code and returns those 18 files
 * to their earlier counts; that is a line of S9's falsifier.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { productionFiles, ROOT } from "./import-census.ts";
import { productAssemblyPaths } from "../../../apps/web/scripts/product-assembly.ts";

const frozen: Record<string, number> = JSON.parse(
  readFileSync(new URL("./product-names.baseline.json", import.meta.url), "utf8"),
);

const GENERIC = [
  "apps/host/src",
  "apps/web/src/route",
  "apps/web/src/shell",
  "packages/runtime/src",
  "packages/mcps/src",
  "packages/agent-contracts/src",
  "tests/e2e",
];
/** Registration sites: the only generic files that may name a product. */
const ALLOWED = new Set([
  "apps/host/src/command-registry.ts",
  "apps/host/src/routes.generated.ts",
  ...Object.values(productAssemblyPaths).map((file) => file.slice("ts/".length)),
  "packages/host-contracts/src/product-paths.ts",
  "packages/agent-contracts/src/routes/table.generated.ts",
  "packages/agent-contracts/src/generated/route-directory.ts",
  "packages/agent-contracts/src/generated/command-axes.generated.ts",
]);
// Names of installed product folders, in path, type and constant spelling.
const ids = readdirSync(resolve(ROOT, "products"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => b.length - a.length);
const PRODUCT = new RegExp(
  ids
    .flatMap((id) => [
      "(?<![a-z])" + RegExp.escape(id) + "(?![a-z])",
      RegExp.escape(
        id.replace(/(^|-)([a-z])/g, (_, _dash, letter: string) => letter.toUpperCase()),
      ) + "(?![a-z])",
      RegExp.escape(id.replaceAll("-", "_").toUpperCase()) + "(?![A-Z])",
    ])
    .join("|"),
  "g",
);
const allowed = (path: string) =>
  ALLOWED.has(path) ||
  /^tests\/e2e\/(?:fans?[^/]*|j6-fans-write[^/]*|f1-fans[^/]*)$/.test(path) ||
  path === "packages/host-contracts/src/fixtures/k2-four-fan-walk.json" ||
  path.startsWith("apps/web/src/duct-loss/");

/** Files (path -> text) that name a product in their path or text, with the number of mentions. */
export const productNames = (sources: Record<string, string>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(sources)
      .filter(([path]) => !allowed(path))
      .map(([path, text]) => [path, `${path}\n${text}`.match(PRODUCT)?.length ?? 0] as const)
      .filter(([, count]) => count > 0),
  );

const changes = (actual: Record<string, number>, baseline: Record<string, number>) => ({
  added: Object.entries(actual).filter(([path, count]) => count > (baseline[path] ?? 0)),
  reduced: Object.entries(baseline).filter(([path, count]) => (actual[path] ?? 0) < count),
});

test("generic product mentions never grow and the baseline shrinks with removals", () => {
  const found = productNames(
    Object.fromEntries(
      GENERIC.flatMap(productionFiles).map((path) => [
        path,
        readFileSync(resolve(ROOT, path), "utf8"),
      ]),
    ),
  );
  const rows = Object.entries(found).sort(([, a], [, b]) => b - a);
  const by = (root: string) => rows.filter(([path]) => path.startsWith(`${root}/`));
  console.log(
    [
      `product names: ${rows.length} generic files, ${rows.reduce((sum, [, n]) => sum + n, 0)} mentions`,
      ...GENERIC.map(
        (root) =>
          `  ${root}: ${by(root).length} files, ${by(root).reduce((sum, [, n]) => sum + n, 0)} mentions`,
      ),
      ...rows.map(([path, n]) => `  ${n}\t${path}`),
    ].join("\n"),
  );
  const delta = changes(found, frozen);
  expect(
    delta.added,
    "New or increased product mentions: move rules to their product, never raise the baseline",
  ).toEqual([]);
  expect(
    delta.reduced,
    "Product mentions fell: lower these counts in product-names.baseline.json; remove zero-count files",
  ).toEqual([]);
});

test("the ratchet refuses a new file and one extra mention in an existing file", () => {
  const path = "apps/host/src/builtin-inputs.ts";
  const count = frozen[path] ?? 0;
  expect(changes({ ...frozen, "apps/host/src/planted.ts": 1 }, frozen).added).toEqual([
    ["apps/host/src/planted.ts", 1],
  ]);
  expect(changes({ ...frozen, [path]: count + 1 }, frozen).added).toEqual([[path, count + 1]]);
  expect(changes({ ...frozen, [path]: count - 1 }, frozen).reduced).toEqual([[path, count]]);
  const removed = { ...frozen };
  delete removed[path];
  expect(changes(removed, frozen).reduced).toEqual([[path, count]]);
});

test("the guard counts a planted product name and passes generic text and the allowlist", () => {
  expect(
    productNames({
      "apps/host/src/ducts-actions.ts": `export const x = 1;`,
      "apps/host/src/a.ts": `import { fanIdentity } from "x"; const ductsFans = DUCTS_DEFAULT; type F = FanRow;`,
      "apps/host/src/b.ts": `const fanout = infant + defang; const product = conduct;`,
      "apps/host/src/command-registry.ts": `import { ductsExecutors } from "./ducts-actions.ts";`,
    }),
  ).toEqual({ "apps/host/src/ducts-actions.ts": 1, "apps/host/src/a.ts": 3 });
  for (const name of ids) {
    expect(productNames({ "apps/host/src/planted.ts": `const name = '${name}';` })).toEqual({
      "apps/host/src/planted.ts": 1,
    });
  }
  expect(
    productNames({
      "tests/e2e/fan-roster.ts": "fans",
      "tests/e2e/fans-state.ts": "fans",
      "tests/e2e/j6-fans-write.ts": "fans",
      "tests/e2e/f1-fans.ts": "fans",
      "packages/host-contracts/src/fixtures/k2-four-fan-walk.json": "fans",
      "packages/host-contracts/src/product-paths.ts": "ducts",
      "packages/mcps/src/pea/guides.generated.ts":
        'import { admissionPreflight } from "@pe/fans-contract/admission";',
      "apps/web/src/duct-loss/host.ts": "ducts",
    }),
  ).toEqual({});
  expect(productNames({ "tests/e2e/other.ts": "fans" })).toEqual({ "tests/e2e/other.ts": 1 });
});
