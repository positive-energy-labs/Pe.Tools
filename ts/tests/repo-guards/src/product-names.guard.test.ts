/**
 * ADR 0046: generic code does not name a product, except in a registration allowlist. REPORT-ONLY
 * until the fans cutover moves the first product: the first test prints the census and cannot fail.
 * When it becomes a guard, freeze the printed files as a baseline that only shrinks, as
 * `route-closure.guard.test.ts` does.
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
];
/** Registration sites: the only generic files that may name a product. */
const ALLOWED = new Set([
  "apps/host/src/command-registry.ts",
  "apps/host/src/routes.generated.ts",
  "apps/host/src/product-executors.generated.ts",
  "packages/agent-contracts/src/routes/table.generated.ts",
  "packages/agent-contracts/src/generated/route-directory.ts",
]);
// ponytail: the ducts family only (the ADR's pilot), matched as a word or a camelCase part. Read the
// product names from `ts/products/*` once folders exist there.
const PRODUCT = /(?<![a-z])duct|Duct|DUCT|(?<![A-Za-z])fans?(?![a-z])|Fans?(?![a-z])|FANS?(?![A-Z])/g;

/** Files (path -> text) that name a product in their path or text, with the number of mentions. */
export const productNames = (sources: Record<string, string>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(sources)
      .filter(([path]) => !ALLOWED.has(path))
      .map(([path, text]) => [path, `${path}\n${text}`.match(PRODUCT)?.length ?? 0] as const)
      .filter(([, count]) => count > 0),
  );

test("report only: generic files that name a product", () => {
  const found = productNames(
    Object.fromEntries(GENERIC.flatMap(productionFiles).map((path) => [path, readFileSync(resolve(ROOT, path), "utf8")])),
  );
  const rows = Object.entries(found).sort(([, a], [, b]) => b - a);
  const by = (root: string) => rows.filter(([path]) => path.startsWith(`${root}/`));
  console.log(
    [
      `product names (report only): ${rows.length} generic files, ${rows.reduce((sum, [, n]) => sum + n, 0)} mentions`,
      ...GENERIC.map((root) => `  ${root}: ${by(root).length} files, ${by(root).reduce((sum, [, n]) => sum + n, 0)} mentions`),
      ...rows.map(([path, n]) => `  ${n}\t${path}`),
    ].join("\n"),
  );
});

test("the census counts a planted product name and passes generic text and the allowlist", () => {
  expect(productNames({
    "apps/host/src/ducts-actions.ts": `export const x = 1;`,
    "apps/host/src/a.ts": `import { fanIdentity } from "x"; const ductsFans = DUCTS_DEFAULT; type F = FanRow;`,
    "apps/host/src/b.ts": `const fanout = infant + defang; const product = conduct;`,
    "apps/host/src/command-registry.ts": `import { ductsExecutors } from "./ducts-actions.ts";`,
  })).toEqual({ "apps/host/src/ducts-actions.ts": 1, "apps/host/src/a.ts": 5 });
});
