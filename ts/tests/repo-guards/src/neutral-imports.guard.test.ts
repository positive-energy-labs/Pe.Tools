import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import ts from "typescript";
const root = resolve(import.meta.dirname, "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules"
      ? []
      : e.isDirectory()
        ? files(join(dir, e.name))
        : e.name === "neutral.ts" || e.name.endsWith(".neutral.ts")
          ? [join(dir, e.name)]
          : [],
  );
function forbidden(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  return ts
    .preProcessFile(readFileSync(file, "utf8"), true, true)
    .importedFiles.flatMap(({ fileName }) => {
      const target = fileName.startsWith(".") ? resolve(dirname(file), fileName) : fileName;
      if (
        /^(?:react(?:-dom)?(?:\/|$)|@pe\/web(?:\/|$)|#\/)|\.(?:css|scss|less)$/.test(fileName) ||
        (target.replaceAll("\\", "/").includes("/apps/web/src/") &&
          // Generated closure pins are data, not UI: the builtin manifest imports them.
          !/(?:^|[\\/])(?:.*\.)?neutral(?:\.ts)?$|\.generated\.json$/.test(target))
      )
        return [`${file}: ${fileName}`];
      if (fileName.startsWith(".")) {
        const source = [target, `${target}.ts`, `${target}.tsx`, join(target, "index.ts")].find(
          (path) => /\.[cm]?tsx?$/.test(path) && existsSync(path),
        );
        if (source) return forbidden(source, seen);
      }
      return [];
    });
}
test("neutral modules never import web UI, React, web aliases or styles", () => {
  // One visited set across roots: an edge reached from two neutral modules is one offender.
  const seen = new Set<string>();
  expect(files(join(root, "apps")).flatMap((file) => forbidden(file, seen))).toEqual([]);
});

const extensionlessImports = (source: string) =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((fileName) => fileName.startsWith(".") && !extname(fileName));

test("neutral modules use explicit extensions for relative imports", () => {
  expect(
    files(join(root, "apps")).flatMap((file) =>
      extensionlessImports(readFileSync(file, "utf8")).map((specifier) => `${file}: ${specifier}`),
    ),
  ).toEqual([]);
});

test.each([
  'import { value } from "./value";',
  'import type { Value } from "../value";',
  'export * from "./value";',
  'const value = import("./value");',
])("rejects extensionless neutral dependency: %s", (source) => {
  expect(extensionlessImports(source)).toHaveLength(1);
  expect(extensionlessImports(source.replace('value"', 'value.ts"'))).toEqual([]);
});
