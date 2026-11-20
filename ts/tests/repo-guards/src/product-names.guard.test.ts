import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { ROOT } from "./import-census.ts";
import { importsWorkspace, workspaceFiles, workspaceReferences } from "./workspace-boundary.ts";
import { productAssemblyPaths } from "../../../apps/web/scripts/product-assembly.ts";
import { routeDirectory } from "../../../packages/agent-contracts/src/generated/route-directory.ts";

const folders = (root: string) =>
  readdirSync(resolve(ROOT, root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
const products = folders("products");
const ids = new Set([
  ...products,
  ...routeDirectory.flatMap(({ key, product }) => (product ? [key] : [])),
]);
const packages = new Set(
  products.flatMap((id) =>
    ["contract", "domain", "host", "web"].map((layer) => `@pe/${id}-${layer}`),
  ),
);
const names = new RegExp(
  [...ids]
    .sort((a, b) => b.length - a.length)
    .flatMap((id) => [
      "(?<![a-z])" + RegExp.escape(id) + "(?![a-z])",
      ...(id.includes("-")
        ? [
            "(?<![a-z])" +
              id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) +
              "(?![a-z])",
          ]
        : []),
      RegExp.escape(
        id.replace(/(^|-)([a-z])/g, (_, _dash, letter: string) => letter.toUpperCase()),
      ) + "(?![a-z])",
      RegExp.escape(id.replaceAll("-", "_").toUpperCase()) + "(?![A-Z])",
    ])
    .join("|"),
  "g",
);

const registration = new Set([
  "apps/host/src/command-registry.ts",
  "apps/host/src/routes.generated.ts",
  ...Object.values(productAssemblyPaths).map((file) => file.slice("ts/".length)),
  "packages/host-contracts/src/product-paths.ts",
  ...["host-catalog", "host-ops", "native-effect", "native-homes"].map(
    (file) => `packages/host-contracts/src/generated/${file}.generated.ts`,
  ),
  "packages/agent-contracts/src/routes/table.generated.ts",
  "packages/agent-contracts/src/generated/route-directory.ts",
  "packages/agent-contracts/src/generated/command-axes.generated.ts",
]);
// TODO: Move these three Family contracts when Family gets its own product slice.
const family = new Set(
  ["family.ts", "family-actions.ts", "family-param-spec.ts"].map(
    (file) => "packages/agent-contracts/src/" + file,
  ),
);

test("generic code leaves product names and imports to product homes", () => {
  const roots = [
    "apps/host/src",
    "apps/web/src",
    "tests/e2e",
    ...folders("packages").map((name) => `packages/${name}`),
  ];
  const violations = roots
    .flatMap((root) => workspaceFiles(ROOT, root))
    .flatMap((file) => {
      if (!/\.[cm]?[jt]sx?$/.test(file) || /\.(?:test|spec)\.|\/__tests__\//.test(file)) return [];
      if (/^packages\/[^/]+\/(?:tests?|fixtures)\//.test(file)) return [];
      if (registration.has(file) || family.has(file)) return [];
      const source = readFileSync(resolve(ROOT, file), "utf8");
      const matches = new Set([
        ...(`${file}\n${source}`.match(names) ?? []),
        ...workspaceReferences(file, source).filter(
          (specifier) =>
            (!specifier.includes("*") && importsWorkspace(file, specifier, "products", packages)) ||
            products.some((id) => specifier.startsWith(`@pe/${id}-`)),
        ),
      ]);
      return [...matches].map((match) => `${file}: ${match}`);
    });
  expect(violations, "Move product vocabulary and dependencies to the owning product").toEqual([]);
});
