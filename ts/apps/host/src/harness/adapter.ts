import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSea } from "node:sea";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { HarnessId } from "@pe/agent-contracts";
import { hostProcessIdentity, productInstallLayout } from "@pe/host-contracts/contracts";
import { checkoutLayout } from "@pe/host-contracts/service-identity";

/**
 * One row per harness: the ACP adapter package the host spawns, the CLI the user signs in with, and
 * the official installer for that CLI. Login and install run in a console the user can see.
 */
export const adapters: Record<
  HarnessId,
  { title: string; pkg: string; cli: string; login: string; install: string }
> = {
  claude: {
    title: "Claude Code",
    pkg: "@agentclientprotocol/claude-agent-acp",
    cli: "claude",
    login: "claude auth login",
    install: "irm https://claude.ai/install.ps1 | iex",
  },
  codex: {
    title: "Codex",
    pkg: "@agentclientprotocol/codex-acp",
    cli: "codex",
    login: "codex login",
    install: "irm https://chatgpt.com/codex/install.ps1 | iex",
  },
};

/**
 * The installed host runs each adapter inside its own executable (`Pe.Host.exe --adapter <id>`,
 * dispatched in index.ts), so no second Node ships; a source host runs the adapter's bin under its
 * own Node. The adapter drives the user's own CLI (`adapterCli`), never a shipped one.
 */
export function adapterLaunch(harness: HarnessId): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const cli = adapterCli(harness);
  // A SEA has no fallback CLI: without this path the codex adapter would re-run Pe.Host.exe itself.
  if (isSea() && !isAbsolute(cli))
    throw new Error(`${adapters[harness].title} is not installed (no ${cli}.exe found).`);
  const env: Record<string, string> = isAbsolute(cli)
    ? { [harness === "claude" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH"]: cli }
    : {};
  if (isSea()) return { command: process.execPath, args: ["--adapter", harness], env };
  const override = process.env[`PE_HARNESS_ADAPTER_${harness.toUpperCase()}`];
  const pkgJson = createRequire(import.meta.url).resolve(`${adapters[harness].pkg}/package.json`);
  const bin = JSON.parse(readFileSync(pkgJson, "utf8")).bin as Record<string, string>;
  return {
    command: process.execPath,
    args: [override ?? join(dirname(pkgJson), Object.values(bin)[0]!)],
    env,
  };
}

/** Spawns the harness's adapter over `env` and connects `client` to it; `stderr()` is the tail. */
export function openAdapter(
  harness: HarnessId,
  cwd: string,
  env: Record<string, string | undefined>,
  client: ConstructorParameters<typeof ClientSideConnection>[0],
) {
  const launch = adapterLaunch(harness);
  const child = spawn(launch.command, launch.args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...env, ...launch.env },
    windowsHide: true,
  });
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  const conn = new ClientSideConnection(
    client,
    ndJsonStream(
      Writable.toWeb(child.stdin!),
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    ),
  );
  return { child, conn, stderr: () => stderr };
}

/**
 * The user's own CLI (host ledger 2026-10-08, H1): where the official installer puts it, else the
 * first `<cli>.exe` on PATH, else the bare name (not installed). Only native exes count, because
 * the Claude SDK spawns its executable without a shell.
 */
export function adapterCli(harness: HarnessId): string {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const official =
    harness === "claude"
      ? join(homedir(), ".local", "bin", "claude.exe")
      : join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe");
  if (existsSync(official)) return official;
  const found = spawnSync("where.exe", [`${adapters[harness].cli}.exe`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0]!.trim() : adapters[harness].cli;
}

export function adapterLogin(harness: HarnessId, cli = adapterCli(harness)): string {
  const spec = adapters[harness];
  return cli === spec.cli
    ? spec.login
    : `& '${cli.replaceAll("'", "''")}'${spec.login.slice(spec.cli.length)}`;
}

/** Pea's tools for one thread: `pea mcp`, from source under jiti or the sibling installed pea. */
export function peaMcpServer(
  sourceRoot: string | null,
  hostBaseUrl: string,
  threadId: string,
  hostExecutable = process.execPath,
) {
  const ts = sourceRoot ? join(sourceRoot, checkoutLayout.ts) : null;
  const mcp = ["mcp", "--host", hostBaseUrl];
  return {
    name: "pea",
    command: ts
      ? process.execPath
      : resolve(
          dirname(hostExecutable),
          relative(
            dirname(productInstallLayout["VersionedApp:host"]),
            productInstallLayout["VersionedApp:pea"],
          ),
        ),
    args: ts
      ? [
          join(ts, "node_modules", "jiti", "lib", "jiti-cli.mjs"),
          join(ts, "apps", "pea", "src", "main.ts"),
          ...mcp,
        ]
      : mcp,
    env: [
      { name: hostProcessIdentity.hostBaseUrlVariable, value: hostBaseUrl },
      { name: "PE_THREAD", value: threadId },
    ],
  };
}

/**
 * End stdin, give the adapter 2 s to exit, then kill its whole tree: on win32 `kill()` would leave
 * the adapter's own children (codex app-server, claude CLI, the Pea MCP server) running.
 */
export async function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
  child.stdin?.end();
  if (await Promise.race([exited, new Promise<boolean>((r) => setTimeout(r, 2000, false))])) return;
  if (process.platform === "win32" && child.pid)
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  else child.kill();
}
