import { afterEach, expect, test } from "vite-plus/test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { adapterCli, adapterLaunch, adapterLogin, peaMcpServer } from "../src/harness/adapter.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("a relocated installed host launches shipped Node and Codex without PATH lookup", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-launch-"));
  roots.push(root);
  const runtime = join(root, "bin", "host", "harness");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "package.json"), "{}");
  cpSync(process.execPath, join(runtime, "node.exe"));
  const pkg = (name: string, manifest: object, files: string[] = []) => {
    const directory = join(runtime, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), "");
    }
    return directory;
  };
  const adapter = pkg("@agentclientprotocol/codex-acp", { bin: { "codex-acp": "dist/index.js" } }, [
    "dist/index.js",
  ]);
  pkg("@openai/codex", {});
  const native = `vendor/${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc/bin/codex.exe`;
  const codex = pkg(`@openai/codex-win32-${process.arch}`, {}, [native]);
  const launch = adapterLaunch("codex", runtime);
  expect(launch).toEqual({
    command: join(runtime, "node.exe"),
    args: [join(adapter, "dist/index.js")],
    env: { CODEX_PATH: join(codex, native) },
  });
  expect(adapterCli("codex", runtime)).toBe(join(codex, native));
  expect(adapterLogin("codex", join(codex, native))).toBe(`& '${join(codex, native)}' login`);
  rmSync(join(codex, native));
  expect(() => adapterLaunch("codex", runtime)).toThrow("Harness runtime file is missing");
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
