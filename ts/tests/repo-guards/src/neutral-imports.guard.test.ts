import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
          !/(?:^|[\\/])(?:.*\.)?neutral(?:\.ts)?$/.test(target))
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
  expect(files(join(root, "apps")).flatMap((file) => forbidden(file))).toEqual([]);
});
