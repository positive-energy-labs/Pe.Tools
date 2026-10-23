// Text census only: cannot see event aliases or prove hit-testing, computed styles, or visual contrast.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
// These handlers carry domain intent, geometry picking, or dwell timing, never local hover paint.
const ALLOW: Record<string, string> = {
  "ducts/annotations.tsx": "SVG segment/issue hit proxies and subject-badge lighting",
  "ducts/claims.tsx": "Claim geometry hit proxy lights its underlying part",
  "ducts/schematic.tsx": "SVG chain geometry hit-testing",
  "ducts/proto/e/bar.tsx": "Aggregate chart bars light multiple domain elements",
  "ducts/proto/e/inbox.tsx":
    "90ms issue intent and subject-numbering ownership, including expanded detail",
  "ducts/proto/e/inputs-pane.tsx": "Input source rows light their domain element",
  "ducts/proto/e/tree-sidebar.tsx":
    "Tree ancestors light all descendant elements rather than only the first id",
  "ducts/proto/e/rules-pane.tsx": "Rule rows light the set governed by that rule",
  "ducts/proto/e/run-detail.tsx": "Run and fitting rows light their underlying elements",
  "family/anatomy.tsx": "Part geometry focus, separate from native element identity",
  "family/anatomy-model-views.tsx": "SVG parameter plane hit-testing",
  "family/doc-pane.tsx": "Document evidence engine hover ownership",
  "grounded-doc/view/page-pane.tsx": "Page geometry drives evidence block synchronization",
  "grounded-doc/view/images-pane.tsx": "Markdown image drives evidence block synchronization",
  "machine/notice.tsx": "Pause notice expiry while the person reads it",
  "open/bay.tsx": "File bay preview ownership",
  "space/cuts.tsx": "Spatial cut grip hit-testing",
  "workbench/lens/peek.tsx": "Popover travel funnel and linger timing",
  "rooms/plan.tsx": "SVG region/callout hit-testing",
  "rooms/inbox.tsx": "Room GUID identity is not a numeric Revit element id",
  "takeoff/level-plan.tsx": "SVG zone hit-testing",
  "prototypes/control-surface/variant-T4.tsx": "Disposable prototype pauses its notice timer",
};
it("web hover handlers have named non-paint owners and no route ReachStore", () => {
  const violations: string[] = [];
  for (const file of files(join(ROOT, "apps/web/src"))) {
    if (!/\.tsx?$/.test(file) || file.includes(".test.")) continue;
    const name = relative(join(ROOT, "apps/web/src"), file).replaceAll("\\", "/");
    const source = readFileSync(file, "latin1");
    if (
      file.endsWith(".tsx") &&
      /onMouseEnter|onPointerEnter|onMouseOver/.test(source) &&
      !ALLOW[name]
    )
      violations.push(name);
    if (/\bReachStore\b/.test(source)) violations.push(`${name}: route store`);
  }
  expect(violations).toEqual([]);
});
it("kit hover rules have one reach block and all four rungs", () => {
  const violations: string[] = [];
  let blocksSeen = 0;
  for (const file of files(join(ROOT, "packages/kit/src"))) {
    if (!file.endsWith(".css")) continue;
    const source = readFileSync(file, "latin1");
    const blocks = source.match(/\/\* REACH START[\s\S]*?\/\* REACH END \*\//g) ?? [];
    blocksSeen += blocks.length;
    if (blocks.length) {
      expect(file.endsWith(join("lang", "lang.css"))).toBe(true);
      expect(blocks).toHaveLength(1);
      for (const rung of ["rest", "reach", "hover", "focus"])
        expect(blocks[0]).toContain(`data-reach="${rung}"`);
    }
    if (/:hover/.test(source.replace(/\/\* REACH START[\s\S]*?\/\* REACH END \*\//g, "")))
      violations.push(file);
  }
  expect(blocksSeen).toBe(1);
  expect(violations).toEqual([]);
});

it("ReachStore stays inside kit across source packages", () => {
  const violations: string[] = [];
  for (const kind of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, kind), { withFileTypes: true })) {
      if (!entry.isDirectory() || (kind === "packages" && entry.name === "kit")) continue;
      const sourceRoot = join(ROOT, kind, entry.name, "src");
      if (!existsSync(sourceRoot)) continue;
      for (const file of files(sourceRoot)) {
        if (/\.tsx?$/.test(file) && /\bReachStore\b/.test(readFileSync(file, "latin1")))
          violations.push(relative(ROOT, file));
      }
    }
  }
  expect(violations).toEqual([]);
});
