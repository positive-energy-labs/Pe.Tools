import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { BrowserError } from "./errors.ts";

type BrowserWorker = "keeper" | "attached-guardian";
const workerFlag = "--pe-browser-worker";

function requirePackagedWorkerPlatform() {
  // The non-Windows owned guardian is a generated Node script, not an embedded executable mode.
  if (isSea() && process.platform !== "win32")
    throw new BrowserError(
      "UnsupportedRuntime",
      "Packaged browser workers currently require Windows; use the source CLI on other platforms",
      { outcome: "not-sent" },
    );
}

/** The executable hosts these modes; source workers use the sibling entry under ordinary Node. */
export function browserWorkerCommand(worker: BrowserWorker, configFile: string) {
  const args = [workerFlag, worker, configFile];
  requirePackagedWorkerPlatform();
  if (isSea()) {
    return { command: process.execPath, args };
  }
  const extension = import.meta.url.endsWith(".ts")
    ? ".ts"
    : import.meta.url.endsWith(".mjs")
      ? ".mjs"
      : ".js";
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL(`./worker-entry${extension}`, import.meta.url)), ...args],
  };
}

/** Return before importing a worker when this is an ordinary CLI invocation. */
export async function dispatchBrowserWorker(args: readonly string[] = process.argv.slice(2)) {
  if (args[0] !== workerFlag) return false;
  requirePackagedWorkerPlatform();
  const [, worker, configFile] = args;
  if (args.length !== 3 || !configFile || (worker !== "keeper" && worker !== "attached-guardian"))
    throw new BrowserError("InvalidOptions", "Browser worker requires a mode and one config file", {
      outcome: "not-sent",
    });
  if (worker === "keeper") await (await import("./keeper.ts")).runBrowserKeeper(configFile);
  else await (await import("./attached-guardian.ts")).runAttachedGuardian(configFile);
  return true;
}
