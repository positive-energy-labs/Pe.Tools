/** Crude source census: cannot prove runtime arbitration, focus, or virtual-row arrival timing. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? entry.name === "node_modules"
        ? []
        : files(path)
      : /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)
        ? [path]
        : [];
  });
const sources = ["apps", "packages"].flatMap((kind) =>
  readdirSync(join(ROOT, kind)).flatMap((name) => {
    const src = join(ROOT, kind, name, "src");
    return existsSync(src) ? files(src) : [];
  }),
);
const slashOwners: Record<string, string> = {
  "packages/kit/src/components/lang/list-view.tsx": "The sole list/search arbiter",
  "apps/web/src/chat/composer.tsx":
    "Slash starts the skill menu in the composer; text-field slash remains editing, never list search",
};

test("list navigation has one kit owner for landing, following, persistence and slash", () => {
  const violations: string[] = [];
  for (const path of sources) {
    const rel = path.slice(ROOT.length + 1).replaceAll("\\", "/");
    const source = readFileSync(path, "latin1");
    if (
      (rel.startsWith("apps/web/") &&
        /(?:setAttribute|removeAttribute)\(\s*["']data-landed["']|onChange:\s*\(search:\s*ListSearch/.test(
          source,
        )) ||
      (!rel.startsWith("packages/kit/") && /pendingReveal/.test(source))
    )
      violations.push(rel);
    if (!slashOwners[rel] && /hotkey:\s*["']\/["']|bindings:\s*\[\s*["']\/["']\s*\]/.test(source))
      violations.push(rel);
  }
  expect(violations).toEqual([]);
});
