// Source census only: cannot prove computed appearance, readable names or animation in a browser.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ts = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
const web = files(join(ts, "apps/web/src"));
const sources = [...web, ...files(join(ts, "packages/kit/src"))];
const scan = (paths: string[], pattern: RegExp) =>
  paths.filter((p) => pattern.test(readFileSync(p, "latin1")));

it("damage has one CSS owner and no route-local import", () => {
  const css = sources.filter((p) => p.endsWith(".css"));
  expect(scan(css, /pe-damage-beat|\[data-damage\]/)).toEqual([
    join(ts, "packages/kit/src/components/lang/lang.css"),
  ]);
  expect(scan(web, /import[^;]*scene\/damage\.css/)).toEqual([]);
});

it("meaning tones are closed and subject fallbacks never print ids", () => {
  const code = sources.filter((p) => /\.tsx?$/.test(p));
  expect(scan(code, /tone=["'](?:error|warn|warning|info|success|red|green|meta)["']/)).toEqual([]);
  const subjects = web.filter((p) => p.endsWith(".tsx") && !/test|seed/i.test(p));
  expect(scan(subjects, /(?:element|region) \$\{/)).toEqual([]);
});
