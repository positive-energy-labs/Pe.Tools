/**
 * ADR 0046: generic code names no product outside declared composition sites.
 * No offender baseline: a missed product rule must move to its owning product.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { productionFiles, ROOT } from "./import-census.ts";

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
  "apps/host/src/product-executors.generated.ts",
  "packages/host-contracts/src/product-paths.ts",
  "packages/agent-contracts/src/routes/table.generated.ts",
  "packages/agent-contracts/src/generated/route-directory.ts",
]);
// Product words and camelCase parts, not physical types such as FanRow or DuctInput.
const PRODUCT = /(?<![a-z])duct-systems|(?<![a-z])ducts|Ducts|DUCTS|(?<![a-z])fans(?![a-z])|Fans(?![a-z])|FANS(?![A-Z])/g;
const allowed = (path: string) => ALLOWED.has(path)
  || /^tests\/e2e\/(?:fans?[^/]*|j6-fans-write[^/]*|f1-fans[^/]*)$/.test(path)
  || path === "packages/host-contracts/src/fixtures/k2-four-fan-walk.json"
  || path.startsWith("apps/web/src/duct-loss/");

/** Files (path -> text) that name a product in their path or text, with the number of mentions. */
export const productNames = (sources: Record<string, string>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(sources)
      .filter(([path]) => !allowed(path))
      .map(([path, text]) => [path, `${path}\n${text}`.match(PRODUCT)?.length ?? 0] as const)
      .filter(([, count]) => count > 0),
  );

test("generic files name no product outside composition", () => {
  const found = productNames(
    Object.fromEntries(GENERIC.flatMap(productionFiles).map((path) => [path, readFileSync(resolve(ROOT, path), "utf8")])),
  );
  const rows = Object.entries(found).sort(([, a], [, b]) => b - a);
  const by = (root: string) => rows.filter(([path]) => path.startsWith(`${root}/`));
  console.log(
    [
      `product names: ${rows.length} generic files, ${rows.reduce((sum, [, n]) => sum + n, 0)} mentions`,
      ...GENERIC.map((root) => `  ${root}: ${by(root).length} files, ${by(root).reduce((sum, [, n]) => sum + n, 0)} mentions`),
      ...rows.map(([path, n]) => `  ${n}\t${path}`),
    ].join("\n"),
  );
  expect(found, "Move product rules to their product; fix stale text instead of adding exceptions").toEqual({});
});

test("the guard counts a planted product name and passes generic text and the allowlist", () => {
  expect(productNames({
    "apps/host/src/ducts-actions.ts": `export const x = 1;`,
    "apps/host/src/a.ts": `import { fanIdentity } from "x"; const ductsFans = DUCTS_DEFAULT; type F = FanRow;`,
    "apps/host/src/b.ts": `const fanout = infant + defang; const product = conduct;`,
    "apps/host/src/command-registry.ts": `import { ductsExecutors } from "./ducts-actions.ts";`,
  })).toEqual({ "apps/host/src/ducts-actions.ts": 1, "apps/host/src/a.ts": 3 });
  for (const name of ["fans", "ducts", "duct-systems"]) {
    expect(productNames({ "apps/host/src/planted.ts": `const name = '${name}';` }))
      .toEqual({ "apps/host/src/planted.ts": 1 });
  }
  expect(productNames({
    "tests/e2e/fan-roster.ts": "fans",
    "tests/e2e/fans-state.ts": "fans",
    "tests/e2e/j6-fans-write.ts": "fans",
    "tests/e2e/f1-fans.ts": "fans",
    "packages/host-contracts/src/fixtures/k2-four-fan-walk.json": "fans",
    "packages/host-contracts/src/product-paths.ts": "ducts",
    "apps/web/src/duct-loss/host.ts": "ducts",
  })).toEqual({});
  expect(productNames({ "tests/e2e/other.ts": "fans" }))
    .toEqual({ "tests/e2e/other.ts": 1 });
});
