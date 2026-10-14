import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vite-plus/test";
import { bootHost } from "./real-server.ts";
import { createPagesHandler } from "../src/pages-route.ts";

const watched = vi.hoisted(() => [] as { close: ReturnType<typeof vi.fn> }[]);
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    watch: (...args: Parameters<typeof fs.watch>) => {
      const watcher = fs.watch(...args);
      watched.push({ close: vi.spyOn(watcher, "close") });
      return watcher;
    },
  };
});

test("the Page handler closes active streams and watchers without waiting for clients", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-pages-close-"));
  mkdirSync(join(root, "tour"));
  writeFileSync(join(root, "tour", "index.html"), "<!doctype html><title>Tour</title>");
  const handle = createPagesHandler(root);
  const response = await handle(new Request("http://host/pages/tour/events"));
  const reader = response.body!.getReader();
  try {
    await reader.read();
    handle.close();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(watched.at(-1)!.close).toHaveBeenCalled();
    handle.close();
  } finally {
    await reader.cancel();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("real host shutdown releases its product home before process exit", async () => {
  watched.length = 0;
  const host = await bootHost();
  const response = await fetch(`${host.base}/pages/carriage/events`, {
    signal: AbortSignal.timeout(10_000),
  });
  const reader = response.body!.getReader();
  try {
    expect(response.status).toBe(200);
    await reader.read();
    await expect.poll(() => watched.length).toBeGreaterThan(0);
    const home = process.env.PE_TOOLS_PRODUCT_HOME!;
    await host.close();
    expect(watched.every(({ close }) => close.mock.calls.length > 0)).toBe(true);
    expect(existsSync(home)).toBe(false);
  } finally {
    await reader.cancel().catch(() => {});
  }
});
