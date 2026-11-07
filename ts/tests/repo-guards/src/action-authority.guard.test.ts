import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const src = resolve(import.meta.dirname, "../../../packages/mcps/src");

test("raw Work reads stay inside route-workspace internals", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "apps", "packages"], {cwd: root, encoding:"utf8"}).trim().split(/\r?\n/);
  const offenders = paths.flatMap(path => {
    if (!/\.tsx?$/.test(path) || /\.test[.-]|\/tests\//.test(path) || path === "packages/runtime/src/route-workspace.ts") return [];
    const source = readFileSync(resolve(root, path), "utf8");
    return [...source.matchAll(/\.\s*readRaw\s*\(/g)].map(match => `${path}:${source.slice(0, match.index).split("\n").length}`);
  });
  expect(offenders).toEqual([]);
});

test("Pea has one capability admission door", () => {
  const owners = readdirSync(src, { recursive: true })
    .filter((path) => String(path).endsWith(".ts"))
    .flatMap((path) =>
      [
        ...readFileSync(resolve(src, String(path)), "utf8").matchAll(/function runCapability\b/g),
      ].map(() => String(path).replaceAll("\\", "/")),
    );
  expect(owners).toEqual(["shared/admission.ts"]);
});
