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

/* Web suites import apps/host modules (resource-adapters, host-ownership) whose lane resolution
 * refuses to guess: PE_LANE is the SDK-owned signal and an unset one is a launch-configuration
 * bug. Tests are a source-lane run, so name the lane here rather than weakening the throw. */
process.env.PE_LANE ??= "dev";

/* jsdom has no EventSource. The route handle subscribes readings over SSE on mount, so a suite
 * that never opens a stream still needs the constructor to exist. A suite that wants frames
 * installs its own fake before import; `??=` lets it win. */
class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource ??= DeadSource;
