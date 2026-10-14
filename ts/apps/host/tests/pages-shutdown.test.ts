import { existsSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import { bootHost } from "./real-server.ts";

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

// The provider probe child (cwd under the home) was the pin; a Page stream's watcher ends with its request.
test("real host shutdown closes Page watchers and releases its product home before process exit", async () => {
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
