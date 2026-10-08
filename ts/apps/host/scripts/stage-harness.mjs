import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(host, "../..");
const payload = join(host, "dist-installed");
const destination = join(payload, "harness");
const packageManager = process.env.npm_execpath;
if (!packageManager)
  throw new Error("Run harness staging through the host build:payload package script.");
const temporary = mkdtempSync(join(payload, ".harness-stage-"));
const deployed = join(temporary, "deployed");

function inspect(directory, root, rejectLinks) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      if (rejectLinks) throw new Error(`Staged harness contains a link: ${path}`);
      const target = relative(realpathSync(root), realpathSync(path));
      if (target.startsWith("..") || isAbsolute(target))
        throw new Error(`Harness deploy link escapes its root: ${path}`);
    } else if (stat.isDirectory()) inspect(path, root, rejectLinks);
  }
}

try {
  const args = [
    "--filter",
    "@pe/harness-runtime",
    "deploy",
    "--prod",
    "--frozen-lockfile",
    "--config.inject-workspace-packages=true",
    "--config.node-linker=hoisted",
    deployed,
  ];
  const nativePnpm = join(dirname(packageManager), "pnpm.exe");
  const executable = existsSync(nativePnpm)
    ? nativePnpm
    : packageManager.endsWith(".exe")
      ? packageManager
      : process.execPath;
  const result = spawnSync(
    executable,
    executable === process.execPath ? [packageManager, ...args] : args,
    {
      cwd: workspace,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Harness dependency deployment failed: ${result.error ?? result.status}`);
  inspect(deployed, deployed, false);
  rmSync(destination, { recursive: true, force: true });
  // MSI/zip transport carries ordinary files, not the deploy graph's local package links.
  cpSync(deployed, destination, { recursive: true, dereference: true });
  const license = join(dirname(process.execPath), "LICENSE");
  if (!existsSync(license)) throw new Error(`Node distribution license is missing: ${license}`);
  cpSync(process.execPath, join(destination, "node.exe"));
  cpSync(license, join(destination, "NODE-LICENSE"));
  inspect(destination, destination, true);
  console.log(`Staged portable harness runtime -> ${destination}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
