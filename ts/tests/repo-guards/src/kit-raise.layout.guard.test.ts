// Source scan only: cannot prove browser geometry, dragging, contrast or layout shift.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = join(ROOT, "apps/web/src");
const KIT = join(ROOT, "packages/kit/src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const path = (file: string) => relative(WEB, file).replaceAll("\\", "/");
// Drawn layers and marks must remain registered to their picture, rather than drag independently.
const anchored = {
  "ducts/annotations.tsx": {
    classes: "absolute left-0 top-0",
    why: "SVG annotation layer shares the picture origin",
  },
  "rooms/sketch.tsx": {
    classes: "absolute top-0 left-0",
    why: "SVG sketch layer shares the picture origin",
  },
  "grounded-doc/view/block-markdown.tsx": {
    classes: "pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2",
    why: "link glyph marks its text block",
  },
  "grounded-doc/view/page-pane.tsx": {
    classes: "absolute left-0.5 top-0.5",
    why: "block kind marks its document rectangle",
  },
};
const popup = {
  "revit/element-menu.tsx": "native element action popup",
  "machine/notice.tsx": "detached notification popup",
  "machine/notice-preview.tsx": "notification popup preview",
};
// Disposable studies are not route furniture; production and executable specimens are scanned.
const studies = (name: string) => name.startsWith("prototypes/") || name.startsWith("lab/");
const webFiles = files(WEB).filter((file) => file.endsWith(".tsx") && !file.includes(".test."));

it("picture furniture goes through Floater instead of numeric corner placement", () => {
  expect(
    webFiles
      .filter(
        (file) =>
          !studies(path(file)) &&
          readFileSync(file, "latin1")
            .split("\n")
            .some((line) => {
              if (!/absolute (?:left|right|top|bottom)-[0-9]/.test(line)) return false;
              const mark = anchored[path(file) as keyof typeof anchored];
              return !mark || !line.includes(`className="${mark.classes}"`);
            }),
      )
      .map(path),
  ).toEqual([]);
});

it("web uses inferred support or semantic planes, leaving popup planes to popup owners", () => {
  expect(
    webFiles
      .filter(
        (file) =>
          !(path(file) in popup) &&
          /data-surface=["'](?:recess|artifact)["']/.test(readFileSync(file, "latin1")),
      )
      .map(path),
  ).toEqual([]);
});

it("kit has no host imports", () => {
  expect(
    files(KIT).filter(
      (file) => /\.[jt]sx?$/.test(file) && /["']#\/host\//.test(readFileSync(file, "latin1")),
    ),
  ).toEqual([]);
});

it("kit hover and focus rules never change layout dimensions", () => {
  const changes = files(KIT)
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) => {
      const css = readFileSync(file, "latin1").replace(/\/\*[\s\S]*?\*\//g, "");
      return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(
          ([, selector, body]) =>
            /:(?:hover|focus(?:-visible|-within)?)/.test(selector) &&
            /(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|border(?:-[\w-]+)?-width)\s*:/.test(
              body,
            ),
        )
        .map(([rule]) => `${relative(KIT, file)}: ${rule.trim()}`);
    });
  expect(changes).toEqual([]);
});
