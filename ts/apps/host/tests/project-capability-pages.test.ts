import { expect, test, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootHost } from "./real-server.ts";
import { detachedBridge, sessionView } from "./effect-test.ts";
import { RevitBridge } from "@pe/host-internal/bridge";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/contracts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

test.each([false, true])(
  "cold capabilities HTTP page discovery includes only the targeted project's Pages (unscoped first: %s)",
  async (unscopedFirst) => {
    const root = await mkdtemp(join(tmpdir(), "pe-cap-pages-"));
    const firm = join(root, "04 PE Software Files", "Pe.Tools"),
      project = join(root, "Projects", "Example", "Pe.Tools");
    for (const [home, tier] of [
      [firm, "firm"],
      [project, "project"],
    ]) {
      await mkdir(home!, { recursive: true });
      await writeFile(join(home!, "pe-home.json"), JSON.stringify({ tier }));
    }
    await mkdir(join(project, "Pages", "project-page"), { recursive: true });
    await writeFile(
      join(project, "Pages", "project-page", "index.html"),
      "<title>Project page</title>",
    );
    vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
    const bridge = detachedBridge({
      list: Effect.succeed([
        sessionView({
          sessionId: "fixture",
          connected: true,
          state: { openDocuments: [{ openId: "project", projectHome: "Projects/Example" }] },
        }),
      ]),
    });
    const host = await bootHost({
      revitCompositionFactory: () => ({
        provider: Layer.succeed(RevitBridge, bridge),
        routes: Layer.empty,
      }),
    });
    try {
      const headers = {
        "x-pe-context": host.terminal,
        [HOST_RPC_BRIDGE_SESSION_HEADER]: "fixture",
        [HOST_RPC_DOCUMENT_HEADER]: "project",
      };
      if (unscopedFirst) {
        const free = await (
          await fetch(`${host.base}/pe/capabilities`, {
            headers: { "x-pe-context": host.terminal },
          })
        ).json();
        expect(
          free.capabilities.some((row: { key: string }) => row.key === "page:@pages/project-page"),
        ).toBe(false);
      }
      const scoped = await fetch(`${host.base}/pe/capabilities?open=fixture/project`, { headers });
      expect(scoped.status, await scoped.clone().text()).toBe(200);
      const value = await scoped.json();
      expect(value.capabilities, JSON.stringify(value)).toContainEqual(
        expect.objectContaining({ key: "page:@pages/project-page" }),
      );
      const free = await (
        await fetch(`${host.base}/pe/capabilities`, { headers: { "x-pe-context": host.terminal } })
      ).json();
      expect(
        free.capabilities.some((row: { key: string }) => row.key === "page:@pages/project-page"),
      ).toBe(false);
    } finally {
      await host.close();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
