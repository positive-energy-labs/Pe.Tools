import { expect, test } from "vite-plus/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { makeHttpLive } from "../src/app.ts";
import { productAgentPath } from "../src/product-paths.ts";
import { testInputContext } from "./effect-test.ts";
import { bootHost } from "./real-server.ts";
import { Deferred, Effect } from "effect";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { peaAgentInstructions } from "@pe/mcps";

const instructions = () => join(productAgentPath(), "AGENTS.md");

const composeHost = () =>
  makeHttpLive({
    inputs: testInputContext(),
    capabilities: { revit: false },
    port: 0,
    webRoot: null,
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

test("host starts under a plain temporary override home and writes instructions without bootstrap", async () => {
  rmSync(dirname(productAgentPath()), { recursive: true, force: true });
  expect(existsSync(instructions())).toBe(false);
  const host = await bootHost();
  try {
    expect((await fetch(`${host.base}/host/status`)).status).toBe(200);
    expect(existsSync(productAgentPath())).toBe(true);
    expect(readFileSync(instructions(), "utf8")).toBe(peaAgentInstructions);
  } finally {
    await host.close();
  }
}, 30_000);

test("host start replaces stale instructions through the atomic state store", () => {
  mkdirSync(productAgentPath(), { recursive: true });
  writeFileSync(instructions(), "outdated instructions");
  composeHost();
  expect(readFileSync(instructions(), "utf8")).toBe(peaAgentInstructions);
});

test("host start leaves matching instructions untouched", () => {
  writeFileSync(instructions(), peaAgentInstructions);
  const past = new Date("2000-01-01T00:00:00Z");
  utimesSync(instructions(), past, past);
  const before = statSync(instructions());
  composeHost();
  expect(statSync(instructions()).mtimeMs).toBe(before.mtimeMs);
  expect(readFileSync(instructions(), "utf8")).toBe(peaAgentInstructions);
});
