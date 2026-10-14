import { existsSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { bootHost } from "./real-server.ts";

// A live Page stream watches its folder; Windows refuses to delete a watched home, so close()
// (which deletes it without retry-and-ignore) is red while any watcher or probe child outlives it.
test("real host shutdown ends Page watchers and releases its product home", async () => {
  const host = await bootHost();
  const response = await fetch(`${host.base}/pages/carriage/events`, {
    signal: AbortSignal.timeout(10_000),
  });
  const reader = response.body!.getReader();
  try {
    expect(response.status).toBe(200);
    await reader.read();
    const home = process.env.PE_TOOLS_PRODUCT_HOME!;
    await host.close();
    expect(existsSync(home)).toBe(false);
  } finally {
    await reader.cancel().catch(() => {});
  }
});
