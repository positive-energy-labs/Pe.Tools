import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { imports, ROOT } from "./import-census.ts";

export function workspaceFiles(root: string, dir: string) {
  function visit(folder: string): string[] {
    return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
      const file = posix.join(folder, entry.name);
      if (entry.isDirectory())
        return ["dist", "dist-installed", "node_modules"].includes(entry.name) ? [] : visit(file);
      return /\.[cm]?[jt]sx?$/.test(file) || entry.name === "package.json" ? [file] : [];
    });
  }
  return visit(dir);
}

export function workspaceNames(root: string, dir: string) {
  return new Set(
    readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => JSON.parse(readFileSync(join(root, dir, entry.name, "package.json"), "utf8")).name as string),
  );
}

export function workspaceReferences(file: string, source: string): string[] {
  if (!file.endsWith("/package.json"))
    return imports(source, file, true).map(({ module }) => module);
  const manifest = JSON.parse(source);
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
}

export function importsWorkspace(file: string, specifier: string, dir: string, names: ReadonlySet<string>) {
  if (specifier.startsWith("."))
    return posix.join(posix.dirname(file), specifier).startsWith(dir + "/");
  return names.has(specifier.split("/").slice(0, 2).join("/"));
}

export function productAppImports(root = ROOT) {
  const apps = workspaceNames(root, "apps");
  return workspaceFiles(root, "products").flatMap((file) =>
    workspaceReferences(file, readFileSync(join(root, file), "utf8"))
      .filter((specifier) => importsWorkspace(file, specifier, "apps", apps))
      .map((specifier) => file + " -> " + specifier),
  ).sort();
}
