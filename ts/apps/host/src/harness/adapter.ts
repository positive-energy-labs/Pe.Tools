import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
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

/** A SEA cannot execute another Node script; its adapters run in the shipped child runtime. */
export function adapterLaunch(
  harness: HarnessId,
  runtimeRoot: string | null = isSea() ? join(dirname(process.execPath), "harness") : null,
): { command: string; args: string[]; env: Record<string, string> } {
  const override = process.env[`PE_HARNESS_ADAPTER_${harness.toUpperCase()}`];
  const command = runtimeRoot ? join(runtimeRoot, "node.exe") : process.execPath;
  const manifest = runtimeRoot
    ? join(runtimeRoot, "package.json")
    : createRequire(import.meta.url).resolve("@pe/harness-runtime/package.json");
  const require = createRequire(manifest);
  const pkgJson = require.resolve(`${adapters[harness].pkg}/package.json`);
  const bin = JSON.parse(readFileSync(pkgJson, "utf8")).bin as Record<string, string>;
  const entry = override ?? join(dirname(pkgJson), Object.values(bin)[0]!);
  const env: Record<string, string> = {};
  if (runtimeRoot && harness === "codex") env.CODEX_PATH = adapterCli(harness, runtimeRoot);
  for (const path of [command, entry, ...Object.values(env)])
    if (!existsSync(path)) throw new Error(`Harness runtime file is missing: ${path}`);
  return { command, args: [entry], env };
}

/** Installed login uses the same native CLI as inference, without a global CLI installation. */
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

export function adapterCli(
  harness: HarnessId,
  runtimeRoot: string | null = isSea() ? join(dirname(process.execPath), "harness") : null,
): string {
  if (!runtimeRoot) return adapters[harness].cli;
  const require = createRequire(join(runtimeRoot, "package.json"));
  const adapter = createRequire(require.resolve(`${adapters[harness].pkg}/package.json`));
  if (harness === "claude") {
    const sdk = createRequire(adapter.resolve("@anthropic-ai/claude-agent-sdk"));
    return sdk.resolve(`@anthropic-ai/claude-agent-sdk-win32-${process.arch}/claude.exe`);
  }
  const codex = createRequire(adapter.resolve("@openai/codex/package.json"));
  const native = codex.resolve(`@openai/codex-win32-${process.arch}/package.json`);
  const triple = process.arch === "arm64" ? "aarch64" : "x86_64";
  return join(dirname(native), "vendor", `${triple}-pc-windows-msvc`, "bin", "codex.exe");
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
