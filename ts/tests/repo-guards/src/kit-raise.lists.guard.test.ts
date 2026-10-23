// Source census only: cannot detect computed markup, navigation hidden behind callbacks, or actual keyboard/preview behavior.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const sources = files(root).filter(
  (path) =>
    path.endsWith(".tsx") && !/[/\\](design-system|prototypes|lab)[/\\]|\.test\./.test(path),
);
const allow = {
  "components/lang/leg-strip.tsx": "Fixed receipt-stage status chips, with no picks or navigation.",
  "ducts/docs.tsx": "Tutorial prose, with no row navigation.",
  "ducts/proto/e/preview-lines.tsx":
    "Static text describing proposed changes and refusals, with no picks.",
  "lib/schema-to-field-render/field-metadata.tsx":
    "Static field validation messages, with no picks.",
  "space/manifest.tsx":
    "Fixed tutorial keys describing layers and encodings, with no row navigation.",
  "space/facts.tsx": "Encoding mark-and-word legend, with no row navigation.",
};

it("navigation lists use the kit", () => {
  const found = sources
    .filter((path) => /<ul\b|<li\b|role=["']list["']/.test(readFileSync(path, "latin1")))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
  expect(found).toEqual(Object.keys(allow).sort());
});

it("every picture controller has a go-to subject picker", () => {
  const missing = sources
    .filter((path) => {
      const text = readFileSync(path, "latin1");
      return /\buseStage\s*\(/.test(text) && !/<GoTo(?:Popup|Subject)\b/.test(text);
    })
    .map((path) => relative(root, path));
  expect(missing).toEqual([]);
});
