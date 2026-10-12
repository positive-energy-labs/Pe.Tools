import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The PATH a fresh PowerShell has after the user's profile ran, read once per host start. A harness
 * child inherits the host's env, and the host inherited whatever launched it (under the dev runner,
 * three `node_modules/.bin` entries lead); the user's profile entries and anything installed since
 * never reach it, so the agents guess (kaitpw 2026-10-04). The shell starts from the registry PATH,
 * machine then user, not from the host's, else the host's entries lead the capture too. Null when
 * not on Windows or the shell did not answer in time: the child keeps the host's PATH.
 */
export function captureUserShellPath(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = [
    "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    "if (Test-Path $PROFILE) { try { . $PROFILE } catch {} }",
    "Write-Output ('PE_SHELL_PATH=' + $env:Path)",
  ].join("; ");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NonInteractive", "-NoProfile", "-Command", script],
      { timeout: 10_000, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        const line = String(stdout ?? "")
          .split(/\r?\n/)
          .findLast((item) => item.startsWith("PE_SHELL_PATH="));
        resolve(!error && line ? line.slice("PE_SHELL_PATH=".length).trim() || null : null);
      },
    );
  });
}

/** The user's entries first, then the host's entries it lacks, so nothing the host had is lost. */
export function mergePath(user: string, host: string | undefined): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of [...user.split(";"), ...(host ?? "").split(";")]) {
    const trimmed = entry.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    entries.push(trimmed);
  }
  return entries.join(";");
}

/** The user's own Codex config, which a Codex child reads too. */
export const userCodexConfigPath = () =>
  join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml");

/**
 * The MCP servers the user's own Codex config declares, by `[mcp_servers.<name>]` header; sub-tables
 * such as `[mcp_servers.<name>.env]` name the same server. No TOML parser: the headers are the fact.
 * They are disabled for Pea children through a project-level config in the world root, because
 * codex-acp replaces a CODEX_CONFIG `mcp_servers` table with the session's own servers (2026-10-04).
 */
export async function userCodexMcpServers(configPath: string): Promise<string[]> {
  const text = await readFile(configPath, "utf8").catch(() => "");
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\[mcp_servers\.([^\].\s"']+)(?:\.[^\]]*)?\]/.exec(line);
    if (match) names.add(match[1]!);
  }
  return [...names];
}

/** The project-level Codex config Pea writes in the world root: the user's own servers, off by name. */
export function peaCodexProjectConfig(names: readonly string[]): string {
  return [
    "# Written by Pea at every host start. Your own Codex MCP servers (~/.codex/config.toml) stay",
    "# out of Pea threads; Pea attaches its own. Edits here are overwritten.",
    ...names.flatMap((name) => ["", `[mcp_servers.${JSON.stringify(name)}]`, "enabled = false"]),
    "",
  ].join("\n");
}

export async function writePeaCodexProjectConfig(worldRoot: string, names: readonly string[]) {
  await mkdir(join(worldRoot, ".codex"), { recursive: true });
  await writeFile(join(worldRoot, ".codex", "config.toml"), peaCodexProjectConfig(names), "utf8");
}
