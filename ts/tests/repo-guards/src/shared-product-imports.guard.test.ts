import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { expect, test } from "vite-plus/test";
import { imports, ROOT } from "./import-census.ts";

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
  if (specifier.startsWith(".")) {
    const path = posix.join(posix.dirname(file), specifier);
    return path.startsWith("products/") || path.startsWith("packages/mcps/");
  }
  const name = specifier.split("/").slice(0, 2).join("/");
  return name === "@pe/mcps" || productNames.has(name);
}

test("shared packages cannot import Pea's product assembly indirectly", () => {
  expect(productImport("packages/runtime/src/p.ts", "@pe/mcps/product-actions")).toBe(true);
  expect(productImport("packages/runtime/src/p.ts", "../../mcps/src/pea/product-actions.ts")).toBe(true);
  expect(productImport("packages/runtime/src/p.ts", "@pe/agent-contracts")).toBe(false);
});

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = posix.join(dir, entry.name);
    if (entry.isDirectory())
      return ["dist", "dist-installed", "node_modules"].includes(entry.name) ? [] : files(file);
    return /\.[cm]?[jt]sx?$/.test(file) || entry.name === "package.json" ? [file] : [];
  });
}

test("shared packages leave product imports to the Pea tools package", () => {
  const shared = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "mcps")
    .flatMap((entry) => files(posix.join("packages", entry.name)));
  const violations = shared.flatMap((file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    const manifest = file.endsWith("/package.json") ? JSON.parse(source) : null;
    const specifiers = manifest
      ? Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.optionalDependencies,
          ...manifest.peerDependencies,
        })
      : imports(source, file, true).map(({ module }) => module);
    return specifiers
      .filter((spec) => productImport(file, spec))
      .map((spec) => `${file} -> ${spec}`);
  });
  expect(violations.sort()).toEqual([]);
});
