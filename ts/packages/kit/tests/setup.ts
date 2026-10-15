import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// jsdom does not load CSS. Use the shipped root tokens for module-scope token reads.
if (typeof document !== "undefined") {
  const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/base.css"), "utf8");
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const match of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    document.documentElement.style.setProperty(match[1], match[2].trim());
}
