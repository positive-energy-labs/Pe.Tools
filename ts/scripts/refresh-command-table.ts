import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A fresh process reads the just-written catalog, which can still be cached in either producer.
const cwd = fileURLToPath(new URL("../packages/mcps/", import.meta.url));
const result = spawnSync(process.execPath,
  ["--import", "jiti/register", "scripts/command-axes.ts", ...process.argv.slice(2)],
  { cwd, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
