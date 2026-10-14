import { afterEach, expect, test, vi } from "vite-plus/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as adapter from "../src/harness/adapter.ts";
import { createProviders } from "../src/harness/providers.ts";

let child: ChildProcess | undefined;
let root: string | undefined;
const prior = process.env.PE_TOOLS_PRODUCT_HOME;
afterEach(async () => {
  await adapter.stopChild(child ?? null);
  vi.restoreAllMocks();
  if (prior === undefined) delete process.env.PE_TOOLS_PRODUCT_HOME;
  else process.env.PE_TOOLS_PRODUCT_HOME = prior;
  if (root) rmSync(root, { recursive: true, force: true });
});

test("provider shutdown releases a real probe child cwd before the product home is removed", async () => {
  root = mkdtempSync(join(tmpdir(), "pe-provider-lifetime-"));
  process.env.PE_TOOLS_PRODUCT_HOME = root;
  let started!: () => void;
  const spawned = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(adapter, "openAdapter").mockImplementation((_harness, cwd, env) => {
    // The real OS process holds its cwd, exactly as the production ACP adapter does.
    child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setInterval(() => {}, 1000);",
      ],
      { cwd, env, stdio: "pipe", windowsHide: true },
    );
    child.once("spawn", started);
    return {
      child,
      conn: { initialize: () => new Promise(() => {}) },
      stderr: () => "",
    } as unknown as ReturnType<typeof adapter.openAdapter>;
  });
  const providers = createProviders({ shellPath: async () => "", probeOnStart: false });
  const probing = providers.fetch(
    new Request("http://host/pe/providers/claude/probe", { method: "POST" }),
  );
  await spawned;
  if (process.platform === "win32")
    expect(() => rmSync(root!, { recursive: true, force: true })).toThrow(/EPERM|EBUSY/);
  await providers.close();
  await probing;
  expect(child!.exitCode).not.toBe(null);
  rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("shutdown fences startup probes still waiting for the shell PATH", async () => {
  let finish!: (path: string) => void;
  const path = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const opened = vi.spyOn(adapter, "openAdapter");
  const providers = createProviders({ shellPath: () => path });
  const notified = vi.fn();
  providers.subscribe(notified);
  await providers.close();
  finish("");
  await providers.close();
  expect(opened).not.toHaveBeenCalled();
  expect(notified).not.toHaveBeenCalled();
});
