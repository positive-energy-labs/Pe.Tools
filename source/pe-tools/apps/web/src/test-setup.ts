/* Test lane only. jsdom loads no stylesheet, so `lib/token.ts` would throw on the first
 * module-scope read. Project base.css's light `:root` block onto the document root so the
 * runtime token read answers the same values the browser does. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof document !== "undefined") {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "base.css"), "utf8");
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    document.documentElement.style.setProperty(m[1], m[2].trim());
  }
}
