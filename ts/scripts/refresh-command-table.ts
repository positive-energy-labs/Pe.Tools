import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function regenerateCommandTable(check: boolean) {
  // A fresh process reads the just-written catalog, not this process's cached modules.
  const cwd = fileURLToPath(new URL("../packages/mcps/", import.meta.url));
  const result = spawnSync(process.execPath,
    ["--import", "jiti/register", "scripts/command-axes.ts", ...(check ? ["--check"] : [])],
    { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
