// Stages the built web SPA into the host payload (contract with the C# installer:
// static root = <dir of Pe.Host.exe>/web/client). Run via `pnpm --filter @pe/host build:payload`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "dist", "client");
const dest = join(here, "..", "dist-installed", "web", "client");

if (!existsSync(src)) {
  console.error(`web build not found at ${src} — run \`pnpm --filter @pe/web build\` first`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`staged web SPA -> ${dest}`);
