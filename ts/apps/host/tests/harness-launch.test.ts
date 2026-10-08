import { afterEach, expect, test } from "vite-plus/test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { adapterCli, adapterLaunch, adapterLogin, peaMcpServer } from "../src/harness/adapter.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("a source host runs the adapter bin under its own Node and hands it the user's CLI", () => {
  const launch = adapterLaunch("codex");
  expect(launch.command).toBe(process.execPath);
  expect(launch.args[0]).toMatch(/codex-acp[\\/]dist[\\/]index\.js$/);
  const cli = adapterCli("codex");
  expect(launch.env).toEqual(isAbsolute(cli) ? { CODEX_PATH: cli } : {});
  if (isAbsolute(cli)) expect(cli).toMatch(/codex\.exe$/i);
});

test("installed subscription login quotes a native path for PowerShell", () => {
  expect(adapterLogin("claude", "C:/Pea's runtime/claude.exe")).toBe(
    "& 'C:/Pea''s runtime/claude.exe' auth login",
  );
  expect(adapterLogin("codex", "codex")).toBe("codex login");
});

test("installed MCP uses sibling Pea and exact host/thread while dev keeps source execution", () => {
  const root = join(tmpdir(), "relocated Pe.Tools");
  const installed = peaMcpServer(
    null,
    "http://127.0.0.1:52123",
    "thread-1",
    join(root, "bin", "host", "Pe.Host.exe"),
  );
  expect(installed.command).toBe(join(root, "bin", "pea", "pea.exe"));
  expect(installed.args).toEqual(["mcp", "--host", "http://127.0.0.1:52123"]);
  expect(installed.env).toContainEqual({ name: "PE_THREAD", value: "thread-1" });
  const dev = peaMcpServer(root, "http://127.0.0.1:52123", "thread-2");
  expect(dev.command).toBe(process.execPath);
  expect(dev.args).toEqual([
    join(root, "ts", "node_modules", "jiti", "lib", "jiti-cli.mjs"),
    join(root, "ts", "apps", "pea", "src", "main.ts"),
    "mcp",
    "--host",
    "http://127.0.0.1:52123",
  ]);
});
