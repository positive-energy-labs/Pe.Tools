import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
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
const watcher = watch(new URL("../src/", import.meta.url), { recursive: true }, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    restart = true;
    disconnect();
  }, 150);
});
const stop = () => {
  stopped = true;
  watcher.close();
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
