import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";

let child: ChildProcess | undefined;
let restart = false;
let stopped = false;
let retired = false;
let debounce: NodeJS.Timeout | undefined;
let killTimeout: NodeJS.Timeout | undefined;
const disconnect = () => {
  if (child?.connected) {
    child.disconnect();
    const owned = child;
    killTimeout = setTimeout(() => owned.kill(), 10_000).unref();
  }
};
// TODO: Include the fs.watch event and path in the restart log. Observed restarts cannot yet be
// attributed to a real source write or a spurious notification because this callback drops both.
const changed = () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    restart = true;
    disconnect();
  }, 150);
};
const packages = new URL("../../../packages/", import.meta.url);
const watchRoots = [
  new URL("../src/", import.meta.url),
  ...readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => new URL(`${entry.name}/src/`, packages))
    .filter((root) => existsSync(root)),
];
const watchers = watchRoots.map((root) => watch(root, { recursive: true }, changed));
const stop = () => {
  stopped = true;
  for (const watcher of watchers) watcher.close();
  clearTimeout(debounce);
};
const interrupt = () => {
  stop();
  disconnect();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  do {
    restart = false;
    child = spawn(
      process.execPath,
      [
        "--import",
        "jiti/register",
        fileURLToPath(new URL("../src/dev.ts", import.meta.url)),
        ...process.argv.slice(2),
      ],
      {
        cwd: new URL("../", import.meta.url),
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        windowsHide: true,
      },
    );
    child.on("message", (message) => {
      if (message === "retired") {
        retired = true;
        stop();
      }
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("exit", resolve);
    });
    clearTimeout(killTimeout);
    if (stopped || !restart) {
      process.exitCode = stopped ? 0 : (code ?? 1);
      break;
    }
    console.log("Host source changed. Restarting dev session.");
  } while (!stopped);
} finally {
  stop();
  disconnect();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (retired) console.log("Dev session retired. Host, frontend, and watcher stopped.");
