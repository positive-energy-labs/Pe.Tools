import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export type RuntimeTuiRenderer = "opentui" | "charsm" | "glyph" | "rezi" | "nberlette";

const tuiRenderers: readonly RuntimeTuiRenderer[] = [
  "opentui",
  "charsm",
  "glyph",
  "rezi",
  "nberlette",
];

/** Parse a `--renderer` flag value into a known beta-TUI renderer. */
export function parseTuiRenderer(value: string | undefined): RuntimeTuiRenderer | undefined {
  if (!value) return undefined;
  if ((tuiRenderers as readonly string[]).includes(value)) return value as RuntimeTuiRenderer;
  throw new Error(`Invalid beta TUI renderer: ${value}`);
}

/** Parse an optional `--port` flag value into a validated port number. */
export function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`Invalid port: ${value}`);
  return port;
}

/**
 * The beta TUI needs Node's experimental FFI. If it is not enabled, re-exec the
 * current CLI with the flag set (upgrading the Node version when too old) and
 * return `true` so the caller can stop. Returns `false` when FFI is available.
 */
export function reexecWithNodeFfiIfNeeded(): boolean {
  if (hasNodeFfiEnabled()) return false;
  if (process.env.PE_TUI_NODE_FFI_REEXEC === "1") return false;

  const result =
    nodeMajorVersion() >= 26
      ? spawnSync(process.execPath, createNodeFfiReexecArgs(), {
          stdio: "inherit",
          env: { ...process.env, PE_TUI_NODE_FFI_REEXEC: "1" },
        })
      : spawnSync("vp", ["env", "exec", "--node", "26.3.0", "node", ...createNodeFfiReexecArgs()], {
          stdio: "inherit",
          env: { ...process.env, PE_TUI_NODE_FFI_REEXEC: "1" },
        });
  process.exit(result.status ?? 1);
}

function hasNodeFfiEnabled(): boolean {
  if (process.execArgv.includes("--experimental-ffi")) return true;
  return (process.env.NODE_OPTIONS ?? "").split(/\s+/).includes("--experimental-ffi");
}

function nodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function createNodeFfiReexecArgs(): string[] {
  const entryArgs = process.argv.slice(1);
  const entryPath = entryArgs[0];
  if (entryPath?.endsWith(".ts")) return ["--experimental-ffi", resolveJitiCliPath(), ...entryArgs];
  return ["--experimental-ffi", ...process.execArgv, ...entryArgs];
}

function resolveJitiCliPath(): string {
  return path.join(path.dirname(require.resolve("jiti/package.json")), "lib", "jiti-cli.mjs");
}
