import { spawn, type ChildProcess } from "node:child_process";
import { statSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { createDevTraySupervisor } from "./dev-tray-supervisor.ts";
import { devWatchRoots } from "./dev-watch-roots.ts";

const sourceRoot = checkoutRootFrom(import.meta.dirname);
if (!sourceRoot) throw new Error("Dev watcher must start from a Pe.Tools checkout");
const tray = await createDevTraySupervisor(sourceRoot, process.argv.includes("--show"));

let child: ChildProcess | undefined;
let restart = false;
let stopped = false;
let retired = false;
let debounce: NodeJS.Timeout | undefined;
let killTimeout: NodeJS.Timeout | undefined;
/** The fs.watch notifications behind the pending restart, printed with it. */
let triggers: string[] = [];
const disconnect = () => {
  if (child?.connected) {
    child.disconnect();
    const owned = child;
    killTimeout = setTimeout(() => owned.kill(), 10_000).unref();
  }
};
// Windows reports a read as a change when NTFS last-access updates are on (fs.watch subscribes to
// LAST_ACCESS), so jiti and vite loading the sources restarted the host in a loop (2026-10-01).
// Only an event whose mtime postdates the watch counts, once per mtime; the log names each.
const startedAt = Date.now();
const seen = new Map<string, number>();
const changed = (root: URL) => (event: string, file: string | null) => {
  const path = fileURLToPath(new URL(file ?? "", root));
  let mtime = -1;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {}
  if (mtime <= startedAt || seen.get(path) === mtime) return;
  seen.set(path, mtime);
  triggers.push(`${event} ${path}`);
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    restart = true;
    disconnect();
  }, 150);
};
const watchRoots = devWatchRoots(new URL("../", import.meta.url));
const watchers = watchRoots.map((root) => watch(root, { recursive: true }, changed(root)));
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
    console.log(`Host source changed. Restarting dev session. (${triggers.join("; ")})`);
    triggers = [];
  } while (!stopped);
} finally {
  stop();
  disconnect();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await tray?.stop();
}
if (retired) console.log("Dev session retired. Host, frontend, and watcher stopped.");
