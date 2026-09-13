import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mastra } from "@mastra/core";
import { createPeaProductStateStorageProfile, readLegacyRouteState } from "./profiles.ts";

test("the legacy route census resolves through the proxied store Mastra hands back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-legacy-census-"));
  process.env.PE_TOOLS_STATE_DIR = dir;
  try {
    const profile = createPeaProductStateStorageProfile();
    const request = { protocol: "web", cwd: dir, workspaceRoot: dir } as never;
    const store = await profile.createStore(request);
    const proxied = new Mastra({ storage: store as never, logger: false as never }).getStorage()!;
    expect(proxied).not.toBe(store); // the reason identity keying failed in the real host
    await (
      await proxied.getStore("threadState")
    )?.setState({ threadId: "t", type: "x", value: {} });
    const census = await readLegacyRouteState(proxied as never);
    expect(census.source).toBe(join(dir, "mastra.db"));
    expect(census.rows).toEqual([{ key: JSON.stringify(["t", "x"]), value: "{}" }]);
  } finally {
    delete process.env.PE_TOOLS_STATE_DIR;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
