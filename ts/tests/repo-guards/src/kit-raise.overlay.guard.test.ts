/** Text scan only: cannot prove placement, exclusivity, or detect computed/spread props. No allowlist. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) => !["node_modules", "dist", "dist-installed", ".artifacts", ".git"].includes(e.name),
    )
    .flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : e.name.endsWith(".tsx")
          ? [join(dir, e.name)]
          : [],
    );
it("overlays inherit subject placement and SVG hints have no native title", () => {
  const violations = files(ROOT).flatMap((file) => {
    const source = readFileSync(file, "latin1");
    const web = /[\\/]apps[\\/]web[\\/]src[\\/]/.test(file);
    return [
      web && /<title\b/.test(source) && `${file}: native title`,
      !/[\\/]packages[\\/]kit[\\/]/.test(file) &&
        /\bavoid\s*=/.test(source) &&
        `${file}: avoid override`,
      web &&
        /[\\/](ducts|space|rooms|takeoff)[\\/]/.test(file) &&
        /<(?:PopoverContent|HoverCardContent)\b[^>]*\bside\s*=\s*["'](?:top|bottom|left|right)["']/s.test(
          source,
        ) &&
        `${file}: fixed side`,
    ].filter(Boolean);
  });
  expect(violations).toEqual([]);
});
