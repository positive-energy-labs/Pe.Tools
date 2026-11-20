import { hostState } from "../src/host-ownership.ts";
import { stateMachine } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { expect, test, vi } from "vite-plus/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { makeHttpLive } from "../src/app.ts";

import { hostOwnership } from "../src/host-ownership.ts";
import { stateRoot, stateTree } from "@pe/host-contracts/service-identity";
import { productPathNames } from "@pe/host-contracts/contracts";
import * as contentHomes from "@pe/host-contracts/product-paths";
import { testInputContext } from "./effect-test.ts";
import { bootHost } from "./real-server.ts";
import { Deferred, Effect } from "effect";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { peaAgentInstructions } from "@pe/mcps";
import * as store from "@pe/host-contracts/kinds";

import { prepareAgentDirectory } from "../src/agent-directory.ts";

const instructions = () => join(hostState().agent, "AGENTS.md");

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

test("host preparation continues after an instructions write failure and posts one notice", () => {
  mkdirSync(hostState().agent, { recursive: true });
  writeFileSync(instructions(), "outdated instructions");
  const writeState = store.writeState;
  const write = vi.spyOn(store, "writeState").mockImplementation((path, bytes) => {
    if (path.path === instructions()) throw Error("locked file");
    return writeState(path, bytes);
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(composeHost).not.toThrow();
    const notices = store
      .notices(stateMachine(storedParent(hostState().notices)))
      .filter((n) => n.path === instructions());
    expect(notices).toHaveLength(1);
    expect(notices[0]!.reason).toContain("locked file");
    expect(log).toHaveBeenCalledOnce();
  } finally {
    write.mockRestore();
    log.mockRestore();
  }
});

test.each(["directory", "file"])("host start refuses a .git %s above the override home", (kind) => {
  const home = process.env.PE_TOOLS_PRODUCT_HOME!;
  expect(hostState().agent).toBe(join(home, ".local-state", "state", "Agent"));
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

test("dev override refuses a junction into a checkout", () => {
  const root = mkdtempSync(join(process.env.PE_TEST_HOME_ROOT!, "agent-junction-"));
  const checkout = join(root, "checkout");
  const target = join(checkout, "agent");
  const junction = stateTree(root).agent;
  mkdirSync(target, { recursive: true });
  mkdirSync(join(checkout, ".git"));
  mkdirSync(dirname(junction), { recursive: true });
  symlinkSync(target, junction, "junction");
  const priorRoot = hostOwnership.rootPath;
  Object.defineProperty(hostOwnership, "rootPath", { value: root, configurable: true });
  try {
    expect(prepareAgentDirectory).toThrow(/git checkout ancestor/);
  } finally {
    Object.defineProperty(hostOwnership, "rootPath", { value: priorRoot, configurable: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("instructions replacement uses the atomic write door", () => {
  mkdirSync(hostState().agent, { recursive: true });
  writeFileSync(instructions(), "old bytes");
  const write = vi.spyOn(store, "writeState");
  try {
    prepareAgentDirectory();
    expect(write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: instructions(),
        kind: expect.objectContaining({ at: "state" }),
      }),
      peaAgentInstructions,
    );
    expect(readFileSync(instructions(), "utf8")).toBe(peaAgentInstructions);
  } finally {
    write.mockRestore();
  }
});

test("host starts under a plain temporary override home and writes instructions without bootstrap", async () => {
  rmSync(dirname(hostState().agent), { recursive: true, force: true });
  expect(existsSync(instructions())).toBe(false);
  const host = await bootHost();
  try {
    const response = await fetch(`${host.base}/host/status`, { headers: { connection: "close" } });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(existsSync(hostState().agent)).toBe(true);
    expect(readFileSync(instructions(), "utf8")).toBe(peaAgentInstructions);
  } finally {
    await host.close();
  }
}, 30_000);

test("host start replaces stale instructions through the atomic state store", () => {
  mkdirSync(hostState().agent, { recursive: true });
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
    const priorRoot = hostOwnership.rootPath;
    Object.defineProperty(hostOwnership, "rootPath", {
      value: stateRoot("dev", checkout, override),
      configurable: true,
    });
    const content = vi.spyOn(contentHomes, "homeDirs").mockReturnValue([join(checkout, "content")]);
    vi.stubEnv(productPathNames.productHomeVariable, override);
    try {
      expect(hostOwnership.lane).toBe("dev");
      expect(agent).toBe(join(checkout, ".artifacts", "pe-tools", "state", "Agent"));
      composeHost();
      expect(readFileSync(join(agent, "AGENTS.md"), "utf8")).toBe(peaAgentInstructions);
    } finally {
      Object.defineProperty(hostOwnership, "rootPath", { value: priorRoot, configurable: true });
      content.mockRestore();
      vi.unstubAllEnvs();
      rmSync(checkout, { recursive: true, force: true });
    }
  },
);
