import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { ROOT, imports } from "./import-census.ts";
import { importsWorkspace, workspaceReferences } from "./workspace-boundary.ts";
import owed from "./product-names.baseline.json" with { type: "json" };
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

// Generated or hand-kept wiring: the one place generic code is handed every product.
const registration = new Set([
  "apps/host/src/command-registry.ts",
  "apps/host/src/routes.generated.ts",
  // The one glob over every product's routes.
  "apps/web/src/route/registry.ts",
  ...Object.values(productAssemblyPaths).map((file) => file.slice("ts/".length)),
  "packages/host-contracts/src/product-paths.ts",
  ...["host-catalog", "host-ops", "native-effect", "native-homes"].map(
    (file) => `packages/host-contracts/src/generated/${file}.generated.ts`,
  ),
  "packages/agent-contracts/src/routes/table.generated.ts",
  "packages/agent-contracts/src/generated/route-directory.ts",
  "packages/agent-contracts/src/generated/command-axes.generated.ts",
]);
// Every other exception is one file, or one directory ending in "/", with its reason.
const exceptions = [
  // TODO: Move these three Family contracts when Family gets its own product slice.
  ...["family.ts", "family-actions.ts", "family-param-spec.ts"].map(
    (file) => "packages/agent-contracts/src/" + file,
  ),
  // The guards name the products they police and plant product paths as specimens.
  "tests/repo-guards/",
  // The generator that writes the registration files.
  "apps/web/scripts/product-assembly.ts",
  // Startup lists each product's web folder to decide whether route codegen is stale.
  "apps/web/route-startup.ts",
  // The dev host watches every product package for a restart.
  "apps/host/scripts/dev-watch-roots.ts",
  // The runner that finds each product's own journeys.
  "tests/e2e/product-journeys.config.ts",
];
const excepted = (file: string) =>
  registration.has(file) ||
  exceptions.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));

const isTest = (file: string) => /\.(?:test|spec)\.|\/__tests__\//.test(file);
// A package chosen at run time, `@pe/${id}-contract`, names no package a reader can check.
function variablePackages(file: string, source: string) {
  const found: string[] = [];
  if (!source.includes("`@")) return found;
  const visit = (node: ts.Node) => {
    if (ts.isTemplateHead(node) && /^@[\w-]+\/$/.test(node.text))
      found.push(`package named by a variable: ${node.text}\${...}`);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return found;
}

test("generic code leaves product names and imports to product homes", () => {
  // Everything under ts/ outside ts/products is generic, tests included. Untracked files count,
  // so a new file is seen before it is staged.
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".", ":!products"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 },
  )
    .split("\0")
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && existsSync(resolve(ROOT, file)));
  const found = new Map<string, string[]>();
  const testImports: string[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    if (!isTest(file) && /[.](?:test|spec)/.test(source))
      testImports.push(
        ...imports(source, file, true)
          .filter(({ module }) => /\.(?:test|spec)(?:\.[cm]?[jt]sx?)?$/.test(module))
          .map(({ module }) => `${file} -> ${module}`),
      );
    if (excepted(file)) continue;
    const matches = new Set([
      ...(`${file}\n${source}`.match(names) ?? []),
      ...workspaceReferences(file, source).filter(
        (specifier) =>
          importsWorkspace(file, specifier, "products", packages) ||
          products.some((id) => specifier.startsWith(`@pe/${id}-`)),
      ),
      ...variablePackages(file, source),
    ]);
    if (matches.size) found.set(file, [...matches]);
  }
  expect(testImports, "Only a test may import a test file").toEqual([]);
  // ponytail: the baseline is per file, so an owed file may gain product words until it moves.
  const baseline = new Set<string>(owed);
  expect(
    [...found].flatMap(([file, matches]) =>
      baseline.has(file) ? [] : matches.map((match) => `${file}: ${match}`),
    ),
    "Move product vocabulary and dependencies to the owning product",
  ).toEqual([]);
  expect(
    owed.filter((file) => !found.has(file)),
    "Delete these from product-names.baseline.json: they no longer name a product",
  ).toEqual([]);
}, 60_000);
