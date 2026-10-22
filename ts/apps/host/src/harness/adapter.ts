import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, openSync, realpathSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSea } from "node:sea";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { HarnessId, ProviderRefusal } from "@pe/agent-contracts";
import {
  HOST_CONTEXT_VARIABLE,
  hostProcessIdentity,
  productInstallLayout,
} from "@pe/host-contracts/contracts";
import { checkoutLayout, productRoot } from "@pe/host-contracts/service-identity";
import { codexStandaloneRelease, installCommand } from "./install.ts";

/**
 * One row per harness: the ACP adapter package the host spawns, the CLI the user signs in with, and
 * its official installation source. Login and install run in a console the user can see.
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
    install: installCommand("claude", ""),
  },
  codex: {
    title: "Codex",
    pkg: "@agentclientprotocol/codex-acp",
    cli: "codex",
    login: "codex login",
    get install() {
      return installCommand("codex", codexPackagePath());
    },
  },
};

/**
 * The installed host runs each adapter inside its own executable (`Pe.Host.exe --adapter <id>`,
 * dispatched in index.ts), so no second Node ships; a source host runs the adapter's bin under its
 * own Node. The adapter drives the user's own CLI (`adapterCli`), never a shipped one.
 */
function adapterLaunch(
  harness: HarnessId,
  env: NodeJS.ProcessEnv = process.env,
  detail?: ProviderRefusal,
): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const cli = adapterCli(harness, env, detail);
  // A SEA has no fallback CLI: without this path the codex adapter would re-run Pe.Host.exe itself.
  if (isSea() && !isAbsolute(cli))
    throw new Error(`${adapters[harness].title} is not installed (no ${cli}.exe found).`);
  const cliEnv: Record<string, string> = isAbsolute(cli)
    ? { [harness === "claude" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH"]: cli }
    : {};
  if (isSea()) return { command: process.execPath, args: ["--adapter", harness], env: cliEnv };
  const override = process.env[`PE_HARNESS_ADAPTER_${harness.toUpperCase()}`];
  const pkgJson = createRequire(import.meta.url).resolve(`${adapters[harness].pkg}/package.json`);
  const bin = JSON.parse(readFileSync(pkgJson, "utf8")).bin as Record<string, string>;
  return {
    command: process.execPath,
    args: [override ?? join(dirname(pkgJson), Object.values(bin)[0]!)],
    env: cliEnv,
  };
}

/** Spawns the harness's adapter over `env` and connects `client` to it; `stderr()` is the tail. */
export function openAdapter(
  harness: HarnessId,
  cwd: string,
  env: Record<string, string | undefined>,
  client: ConstructorParameters<typeof ClientSideConnection>[0],
  detail?: ProviderRefusal,
) {
  const launch = adapterLaunch(harness, env, detail);
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

/** Pea's own Codex package: a physical directory under the product root, so OpenAI's junctions never apply. */
export function codexPackagePath(): string {
  return join(productRoot(), "harnesses", "Codex");
}

/**
 * The user's CLI: official install, Pea's downloaded package, then the PATH of `env`.
 * The bare name means not installed. Only native exes count, because
 * the Claude SDK spawns its executable without a shell.
 */
export function adapterCli(
  harness: HarnessId,
  env: NodeJS.ProcessEnv = process.env,
  detail?: ProviderRefusal,
): string {
  const tried = new Set<string>();
  const inspect = (path: string): boolean => {
    if (tried.has(path.toLowerCase())) return false;
    tried.add(path.toLowerCase());
    try {
      const realPath = realpathSync(path);
      const stat = statSync(realPath);
      if (!stat.isFile()) throw new Error("not a file");
      closeSync(openSync(path, "r"));
      if (detail) {
        detail.candidates.push({ path, reason: "readable executable", win32Error: null });
        detail.resolvedExecutable = {
          path,
          realPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      }
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      detail?.candidates.push({
        path,
        reason:
          code === "ENOENT"
            ? "missing or inaccessible reparse target (ENOENT)"
            : `inaccessible or reparse traversal failed: ${code ?? String(error)}`,
        win32Error: null,
      });
      return false;
    }
  };
  const finish = (cli: string) => {
    if (detail && process.platform === "win32") explainWindowsFailures(detail, env);
    return cli;
  };
  const home = env.USERPROFILE ?? homedir();
  const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const official =
    harness === "claude"
      ? join(home, ".local", "bin", "claude.exe")
      : join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe");
  if (inspect(official)) return finish(official);
  const packaged = join(codexPackagePath(), "bin", "codex.exe");
  if (harness === "codex" && inspect(packaged)) return finish(packaged);
  const release = harness === "codex" ? codexStandaloneRelease(home) : null;
  if (release && inspect(release)) return finish(release);
  // `env` carries the fresh shell PATH (providers.ts recaptures it per call through `shellPath`), so
  // an install made after host start is found with no restart. `where` also searches cwd, which is
  // not an installation authority.
  const inherited = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const entry of inherited.split(";")) {
    const folder = entry
      .trim()
      .replace(/^"|"$/g, "")
      .replace(
        /%([^%]+)%/g,
        (raw, name: string) =>
          Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? raw,
      );
    if (!isAbsolute(folder)) continue;
    const candidate = join(folder, `${adapters[harness].cli}.exe`);
    if (inspect(candidate)) return finish(candidate);
  }
  if (detail && process.platform === "win32") {
    // Diagnostic only: cwd matches from `where` are not an installation authority.
    const command = join(env.SystemRoot ?? "C:\\Windows", "System32", "where.exe");
    const result = spawnSync(command, [`${adapters[harness].cli}.exe`], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    detail.lookup = {
      command,
      status: result.status,
      reason: result.error?.message ?? (result.stderr.trim() || "completed"),
    };
    for (const path of (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(isAbsolute)) {
      if (!tried.has(path.toLowerCase()))
        detail.candidates.push({
          path,
          reason: "where.exe match outside the explicit install/PATH candidates; not selected",
          win32Error: null,
        });
    }
  }
  return finish(adapters[harness].cli);
}

/** Node's errno loses the Win32 code, including reparse failures. Read it from File.Open's HRESULT. */
function explainWindowsFailures(detail: ProviderRefusal, env: NodeJS.ProcessEnv) {
  const failed = detail.candidates.filter(
    (candidate) => candidate.path !== detail.resolvedExecutable?.path,
  );
  if (!failed.length) return;
  const result = spawnSync(
    join(
      env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      String.raw`
$paths = ConvertFrom-Json ([Console]::In.ReadToEnd())
@($paths | ForEach-Object {
  try {
    $file = [IO.File]::Open($_, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]7)
    $file.Dispose()
    @{ path = $_; code = $null; reason = 'File.Open succeeded on diagnostic recheck' }
  } catch {
    $exception = $_.Exception
    while ($exception.InnerException) { $exception = $exception.InnerException }
    $code = if (($exception.HResult -band 0x7fff0000) -eq 0x00070000) { $exception.HResult -band 0xffff } else { $null }
    @{ path = $PSItem.TargetObject; code = $code; reason = $exception.Message }
  }
}) | ConvertTo-Json -Compress
`,
    ],
    {
      env,
      input: JSON.stringify(failed.map((candidate) => candidate.path)),
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    },
  );
  try {
    if (result.status !== 0)
      throw new Error(
        result.error?.message ?? `PowerShell exited ${result.status}: ${result.stderr.trim()}`,
      );
    const rows = JSON.parse(result.stdout);
    for (const [index, candidate] of failed.entries()) {
      const row = (Array.isArray(rows) ? rows : [rows])[index];
      candidate.win32Error = typeof row?.code === "number" ? row.code : null;
      candidate.reason += `; ${row?.reason ?? "native check returned no result"}`;
    }
  } catch (error) {
    for (const candidate of failed)
      candidate.reason += `; Win32 check unavailable: ${String(error)}`;
  }
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
  context: string,
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
      { name: HOST_CONTEXT_VARIABLE, value: context },
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
