// Source guard only: cannot prove rendered styling, focus, or runtime import resolution.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { langImports, rewrite } from "../../../scripts/codemod-lang-imports.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = join(ROOT, "apps/web/src/components");
const KIT = join(ROOT, "packages/kit/src/components");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? entry.name === "node_modules" ? [] : files(join(dir, entry.name)) : [join(dir, entry.name)],
);

it("folded primitives have no web imports or second component home", () => {
  const oldImport = new RegExp(`['\"]#/components/lang/(?:${Object.keys(langImports).join("|")})['\"]`);
  const imports = files(join(ROOT, "apps/web/src")).filter((file) => /\.[cm]?[jt]sx?$/.test(file) && oldImport.test(readFileSync(file, "latin1")));
  const duplicates = files(WEB).filter((file) => existsSync(join(KIT, file.slice(WEB.length + 1))));
  expect({ imports, duplicates }).toEqual({ imports: [], duplicates: [] });
});

it("the import codemod merges families and can run twice", () => {
  const file = join(WEB, "example.tsx");
  const source = 'import { Kbd } from "./kbd";\nimport { KeyLegend } from "#/components/lang/kbd";\nconst key = <Kbd>?</Kbd>;';
  const next = rewrite(source, file);
  expect(next).toContain('import { KeyHint, KeyLegend } from "@pe/kit/lang/key-hint";');
  expect(next).toContain("<KeyHint>?</KeyHint>");
  expect(rewrite(next, file)).toBe(next);
});
