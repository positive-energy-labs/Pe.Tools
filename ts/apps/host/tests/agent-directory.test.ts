import { expect, test, vi } from "vite-plus/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { makeHttpLive } from "../src/app.ts";
import { productAgentPath } from "../src/product-paths.ts";
import * as productPaths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { stateRoot } from "@pe/host-contracts/service-identity";
import { productPathNames } from "@pe/host-contracts/contracts";
import * as contentHomes from "@pe/host-contracts/product-paths";
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
    routeRegistrations: () => [],
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

test.each([undefined, "", "   "])(
  "dev host start with override %s accepts its checkout-owned default and writes instructions",
  (override) => {
    const checkout = mkdtempSync(join(process.env.PE_TEST_HOME_ROOT!, "dev-checkout-"));
    mkdirSync(join(checkout, ".git"));
    const agent = join(stateRoot("dev", checkout, override), "state", "Agent");
    const path = vi.spyOn(productPaths, "productAgentPath").mockReturnValue(agent);
    const content = vi.spyOn(contentHomes, "homeDirs").mockReturnValue([join(checkout, "content")]);
    vi.stubEnv(productPathNames.productHomeVariable, override);
    try {
      expect(hostOwnership.lane).toBe("dev");
      expect(agent).toBe(join(checkout, ".artifacts", "pe-tools", "state", "Agent"));
      composeHost();
      expect(readFileSync(join(agent, "AGENTS.md"), "utf8")).toBe(peaAgentInstructions);
    } finally {
      path.mockRestore();
      content.mockRestore();
      vi.unstubAllEnvs();
      rmSync(checkout, { recursive: true, force: true });
    }
  },
);
