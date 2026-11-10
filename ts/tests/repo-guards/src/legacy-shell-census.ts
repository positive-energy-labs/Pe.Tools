import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { ROOT, imports } from "./import-census.ts";

export const REPO = resolve(ROOT, "..");
export const git = (...args: string[]) =>
  execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

// Resolve each importer under its owning tsconfig, including paths and package exports.
// Test imports remain in the evidence census, but never spend production's allowance.
export function shellImports() {
  const configs = new Map<string, ts.CompilerOptions>();
  const files = [
    ...new Set(
      git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
        .split("\0")
        .filter(
          (file) =>
            /\.[cm]?[jt]sx?$/.test(file) &&
            !/(?:^|\/)(?:node_modules|dist|dist-installed|generated|vendor)\//.test(file) &&
            existsSync(resolve(REPO, file)),
        ),
    ),
  ];
  return files.flatMap((file) => {
    const absolute = resolve(REPO, file);
    const config = ts.findConfigFile(dirname(absolute), ts.sys.fileExists) ?? "";
    let options = configs.get(config);
    if (!options) {
      options = config
        ? ts.parseJsonConfigFileContent(
            ts.readConfigFile(config, ts.sys.readFile).config,
            ts.sys,
            dirname(config),
          ).options
        : { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
      configs.set(config, options);
    }
    return imports(readFileSync(absolute, "utf8"), file, true).flatMap(({ module }) => {
      const resolved = ts.resolveModuleName(module, absolute, options, ts.sys).resolvedModule;
      if (!resolved) return [];
      const target = relative(REPO, resolved.resolvedFileName).replaceAll("\\", "/");
      return target.startsWith("ts/apps/web/src/shell/")
        ? [
            {
              file,
              module,
              target,
              production:
                !/(?:^|\/)(?:tests?|__tests__|fixtures|prototypes|lab)\/|\.(?:test|spec|typecheck)\./.test(
                  file,
                ),
            },
          ]
        : [];
    });
  });
}

export function legacyCounts(edges = shellImports()) {
  const counts = { mount: 0, legacy: 0, readings: 0 };
  for (const edge of edges) {
    if (!edge.production) continue;
    const name = edge.target.split("/").at(-1)!;
    if (name.startsWith("mount-")) counts.mount++;
    if (name.startsWith("legacy-")) counts.legacy++;
    if (name === "readings.ts") counts.readings++;
  }
  return counts;
}
