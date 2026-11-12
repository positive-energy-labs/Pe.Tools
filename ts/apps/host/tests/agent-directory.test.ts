import { expect, test } from "vite-plus/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeHttpLive } from "../src/app.ts";
import { productAgentPath } from "../src/product-paths.ts";
import { testInputContext } from "./effect-test.ts";
import { bootHost } from "./real-server.ts";
import { Deferred, Effect } from "effect";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";

const composeHost = () => makeHttpLive({
  inputs: testInputContext(), capabilities: { revit: false }, port: 0, webRoot: null,
  lifecycle: {
    latch: Effect.runSync(Deferred.make<void>()),
    handle: Effect.runSync(Deferred.make<ServiceHostHandle>()),
  },
});

test.each(["directory", "file"])("host start refuses a .git %s above the override home", (kind) => {
  const home = process.env.PE_TOOLS_PRODUCT_HOME!;
  expect(productAgentPath()).toBe(join(home, ".local-state", "state", "Agent"));
  const marker = join(dirname(home), ".git");
  expect(existsSync(marker)).toBe(false);
  if (kind === "directory") mkdirSync(marker);
  else writeFileSync(marker, "gitdir: elsewhere");
  try {
    expect(composeHost).toThrow(/Agent directory.*git checkout ancestor.*PE_TOOLS_PRODUCT_HOME/);
  } finally {
    rmSync(marker, { recursive: true, force: true });
  }
});

test("host starts under a plain temporary override home", async () => {
  const host = await bootHost();
  try {
    expect((await fetch(`${host.base}/host/status`)).status).toBe(200);
    expect(existsSync(productAgentPath())).toBe(true);
  } finally {
    await host.close();
  }
}, 30_000);
