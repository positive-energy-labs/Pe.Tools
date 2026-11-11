/**
 * ADR 0035 rule 5: `Pane` and `GraphLayoutView` are not exported to route modules. A route fills
 * slots and returns a branded `Body` (`apps/web/src/route/body.ts`); the kernel alone composes
 * panes and splits. This guard holds that line over every route directory (a directory under
 * `apps/web/src` with a `route.ts`).
 *
 * Exempt: `design-system/`, the owner's one window into the kit, whose specimens draw the
 * primitive itself (ADR 0035 rule 10 keeps it live). Not route directories: `shell/`,
 * `workbench/`, `scene/`, `routes/` (the kernel and its TanStack files).
 *
 * Red at the slice 6 scaffold on chat/ (Pane, GraphLayoutView) and rooms/ (PaneApi from
 * graph-layout); the fill moves those onto `Body` and deletes the imports.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: HERE, encoding: "utf8" }).trim();
const WEB_SRC = resolve(REPO, "ts/apps/web/src");
const EXEMPT = new Set(["design-system"]);

const routeDirs = () =>
  readdirSync(WEB_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXEMPT.has(e.name) && existsSync(join(WEB_SRC, e.name, "route.ts")))
    .map((e) => e.name)
    .sort();

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

/** An import statement whose module is the pane or graph-layout primitive, with the names it takes. */
const IMPORT = /import\s+(type\s+)?(\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+["']([^"']+)["']/g;
const PANE_MODULE = /(^|\/)(lang\/)?pane(\.tsx?)?$/;
const LAYOUT_MODULE = /(^|\/)graph-layout(\.tsx?)?$/;
const KIT_ROOT = /^@pe\/kit$/;
const CHROME_NAMES = new Set(["Pane", "PaneSplit", "GraphLayoutView", "GraphLayoutState", "GraphPaneState", "PaneApi"]);

const names = (clause: string) =>
  clause.startsWith("{")
    ? clause.slice(1, -1).split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!).filter(Boolean)
    : [clause.replace(/^\*\s+as\s+/, "")];

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

test("route modules import neither Pane nor GraphLayoutView (ADR 0035 rule 5)", () => {
  const offenders: string[] = [];
  for (const dir of routeDirs())
    for (const file of sources(join(WEB_SRC, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(IMPORT)) {
        const [, , clause, module] = m;
        const layout = LAYOUT_MODULE.test(module!);
        const pane = PANE_MODULE.test(module!);
        const kit = KIT_ROOT.test(module!);
        if (!layout && !pane && !kit) continue;
        const taken = names(clause!).filter((name) => layout || CHROME_NAMES.has(name));
        if (taken.length)
          offenders.push(`${file.slice(WEB_SRC.length + 1).replaceAll("\\", "/")}:${lineOf(text, m.index!)} imports ${taken.join(", ")} from ${module}`);
      }
    }
  expect(
    offenders,
    `slice 6 gap: these route modules draw chrome themselves; a route returns a Body (route/body.ts) and the kernel composes the pane:\n${offenders.map((o) => `  ${o}`).join("\n")}`,
  ).toEqual([]);
});

test("the guard sees every route directory and exempts only the design-system window", () => {
  const dirs = routeDirs();
  expect(dirs).toContain("chat");
  expect(dirs).toContain("fans");
  expect(dirs).not.toContain("design-system");
  expect(dirs).not.toContain("shell");
});
