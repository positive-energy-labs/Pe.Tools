import { expect, test } from "vite-plus/test";
import { importsWorkspace, workspaceReferences } from "./workspace-boundary.ts";

const forms = (pkg: string, path: string) => [
  ["import.meta.resolve", 'import.meta.resolve("' + pkg + '/contract")', "source.ts"],
  ["URL asset", 'new URL("' + path + '/a.json", import.meta.url)', "source.ts"],
  ["template import", "import(`" + pkg + "/${name}`)", "source.ts"],
  [
    "computed import",
    'import("' + pkg.slice(0, -1) + '" + "' + pkg.slice(-1) + '/api")',
    "source.ts",
  ],
  ["mock", 'vi.mock("' + pkg + '/api")', "source.ts"],
  ["augmentation", 'declare module "' + pkg + '/api" {}', "source.ts"],
  [
    "tsconfig alias",
    JSON.stringify({ compilerOptions: { paths: { alias: [path + "/*"] } } }),
    "tsconfig.json",
  ],
  [
    "workspace manifest",
    JSON.stringify({ peerDependencies: { [pkg]: "workspace:*" } }),
    "package.json",
  ],
];

test.each([
  ...forms("example-product", "../../../products/example/contract").map((row) => [
    "products",
    "example-product",
    "packages/example/src/",
    ...row,
  ]),
  ...forms("@pe/example", "../../../apps/example").map((row) => [
    "apps",
    "@pe/example",
    "products/example/host/",
    ...row,
  ]),
])("%s boundary rejects %s in %s (%s)", (root, pkg, folder, _form, source, filename) => {
  const file = folder + filename;
  expect(
    workspaceReferences(file, source).some((reference) =>
      importsWorkspace(file, reference, root, new Set([pkg])),
    ),
  ).toBe(true);
});

test("sibling package and fixture names remain legal", () => {
  expect(
    importsWorkspace(
      "packages/example/src/source.ts",
      "example-product-extra/api",
      "products",
      new Set(["example-product"]),
    ),
  ).toBe(false);
  expect(
    workspaceReferences("products/example/src/source.ts", "// packages in apps/example").length,
  ).toBe(0);
});
