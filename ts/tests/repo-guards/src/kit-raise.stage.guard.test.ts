/** Text census only: cannot prove camera behavior or see aliases/computed bindings. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const files = (dir: string, prefix = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? files(join(dir, entry.name), `${rel}/`)
      : /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)
        ? [rel]
        : [];
  });

it("camera, history and gesture policy have one scene owner", () => {
  const stray = files(ROOT).flatMap((rel) => {
    if (rel.startsWith("scene/")) return [];
    const source = readFileSync(join(ROOT, rel), "latin1");
    const failures = [
      /import\s*\{[^}]*\b(subjectPose|clearPose)\b[^}]*\}\s*from\s*["']#\/scene\/framing["']/s.test(
        source,
      ) && "framing",
      /hotkey:\s*["']F["']/.test(source) && "frame key",
      /how === "gesture" \? "replace" : "push"/.test(source) && "history move",
      /useScopeGestures\(/.test(source) && "gesture declaration",
      !rel.startsWith("navigation/") &&
        /navigateNativeHistory|hotkey:\s*["']Alt\+Arrow/.test(source) &&
        "history binding",
      /hotkey:\s*"Escape"[^\n]*(?:\n[^\n]*){0,6}\b(?:viewport|toMode|flyTo)\b/.test(source) &&
        "Escape moves view",
    ].filter(Boolean);
    return failures.map((rule) => `${rel}: ${rule}`);
  });
  expect(stray).toEqual([]);
});
