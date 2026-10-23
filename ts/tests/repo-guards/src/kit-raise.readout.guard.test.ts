/** Source census only: cannot prove placement, shrink behavior, or key routing in a browser.
 * Renderers composed under a readout-owning parent are named below; an inset shares that state.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT =
  process.env.PE_READOUT_GUARD_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const files = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? files(join(dir, entry.name), path)
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
  });
const sources = new Map(files(ROOT).map((rel) => [rel, readFileSync(join(ROOT, rel), "latin1")]));
const readout =
  /import\s*\{[^}]*\bPictureReadout\b[^}]*\}\s*from\s*["']@pe\/kit\/lang\/readout["']/;
const PARENTS: Record<string, { owner: string; reason: string }> = {
  "scene/pan-zoom.tsx": {
    owner: "ducts/proto/e/canvas.tsx",
    reason: "the schematic's local viewport shares the picture pane's readout",
  },
  "ducts/model-picture.tsx": {
    owner: "ducts/proto/e/canvas.tsx",
    reason: "model and schematic share the pane's single readout",
  },
  "ducts/proto/e/picture-floaters.tsx": {
    owner: "ducts/proto/e/canvas.tsx",
    reason: "swap-only inset shares the main picture's readout",
  },
  "space/picture.tsx": {
    owner: "space/route.tsx",
    reason: "the route injects its readout slot with domain facts",
  },
  "takeoff/level-plan.tsx": {
    owner: "takeoff/atlas-visual.tsx",
    reason: "the atlas injects its readout slot with domain facts",
  },
};

it("PictureReadout has one import home and web has no hand-built pane crumbs", () => {
  const stray = [...sources]
    .filter(
      ([, text]) =>
        (/import\s*\{[^}]*\bPictureReadout\b/.test(text) && !readout.test(text)) ||
        /data-e-crumb/.test(text) ||
        (/<ChevronRight\b/.test(text) && /\b(?:crumb|breadcrumb)\b/.test(text)),
    )
    .map(([rel]) => rel);
  expect(stray).toEqual([]);
});

it("every picture owns a kit readout or composes beneath a named readout owner", () => {
  const pictures = [...sources].filter(([, text]) =>
    /import\s*\{[^}]*\b(?:Scene3D|usePlaneViewport)\b[^}]*\}\s*from/.test(text),
  );
  const stray = pictures
    .filter(([rel, text]) => !readout.test(text) && !PARENTS[rel])
    .map(([rel]) => rel);
  const brokenParents = Object.entries(PARENTS)
    .filter(
      ([rel, { owner }]) =>
        !pictures.some(([picture]) => picture === rel) ||
        !readout.test(sources.get(owner) ?? "") ||
        !/<PictureReadout\b/.test(sources.get(owner) ?? ""),
    )
    .map(([rel]) => rel);
  expect({ stray, brokenParents }).toEqual({ stray: [], brokenParents: [] });
});
