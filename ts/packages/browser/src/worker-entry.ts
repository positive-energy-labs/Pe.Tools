import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dispatchBrowserWorker } from "./worker.ts";

try {
  if (!(await dispatchBrowserWorker())) throw new Error("Browser worker mode required");
} catch (error) {
  process.stderr.write(String(error) + "\n");
  // A keeper started outside the launcher's job has no stderr pipe; its launcher reads this file.
  const configFile = process.argv.at(-1);
  if (configFile?.endsWith(".json"))
    try {
      appendFileSync(join(dirname(configFile), "worker-error.txt"), String(error) + "\n");
    } catch {}
  process.exitCode = 1;
}
