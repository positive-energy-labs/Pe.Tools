import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { expect, test } from "vite-plus/test";
import { ROOT } from "./import-census.ts";
import { importsWorkspace, workspaceFiles, workspaceReferences } from "./workspace-boundary.ts";

const productNames = new Set(
  readdirSync(join(ROOT, "products"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((product) =>
      readdirSync(join(ROOT, "products", product.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((layer) => {
          try {
            const path = join(ROOT, "products", product.name, layer.name, "package.json");
            return [JSON.parse(readFileSync(path, "utf8")).name as string];
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
          }
        }),
    ),
);

function productImport(file: string, specifier: string): boolean {
  return importsWorkspace(file, specifier, "products", productNames) ||
    importsWorkspace(file, specifier, "packages/mcps", new Set(["@pe/mcps"]));
}

test("shared packages cannot import Pea's product assembly indirectly", () => {
  expect(productImport("packages/runtime/src/p.ts", "@pe/mcps/product-actions")).toBe(true);
  expect(productImport("packages/runtime/src/p.ts", "../../mcps/src/pea/product-actions.ts")).toBe(true);
  expect(productImport("packages/runtime/src/p.ts", "@pe/agent-contracts")).toBe(false);
});

test("shared packages leave product imports to the Pea tools package", () => {
  const shared = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "mcps")
    .flatMap((entry) => workspaceFiles(ROOT, posix.join("packages", entry.name)));
  const violations = shared.flatMap((file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    return workspaceReferences(file, source)
      .filter((spec) => productImport(file, spec))
      .map((spec) => `${file} -> ${spec}`);
  });
  expect(violations.sort()).toEqual([]);
});
