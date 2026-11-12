import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { join, relative, isAbsolute, sep } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { resolvePeaProductHomePath, resolvePeaSkillPaths } from "@pe/mcps";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostContextTokenPath,
  productRoot,
  productScratchPath,
  stateRoot,
} from "@pe/host-contracts/service-identity";
import * as productPaths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { getHostStatus } from "../src/local-ops.ts";

// Most tests here compute paths from invented roots and touch no disk, so the test-isolation
// tripwire (which only polices real resolution) stands down for this file.
beforeEach(() => vi.stubEnv("PE_TEST_HOME_ROOT", ""));
afterEach(() => vi.unstubAllEnvs());
const runtime = () =>
  productRoot({
    lane: "dev",
    sourceRoot: checkoutRootFrom(import.meta.dirname),
    installedRoot: null,
  });

test("every production resolver output follows one locally selected product environment", () => {
  const home = mkdtempSync(join(tmpdir(), "pe-environment-"));
  vi.stubEnv(productPathNames.productHomeVariable, home);
  try {
    // Content resolvers follow the home live; state resolvers sit under the root hostOwnership
    // computed once at startup (from the same variable), so they are checked against that root.
    const content = new Set([
      "productUserContentRootPath",
      "productPodsRootPath",
      "productPagesRootPath",
    ]);
    for (const [name, resolver] of Object.entries(productPaths).filter(
      ([name]) => !content.has(name),
    ))
      expect(relative(hostOwnership.rootPath, resolver()).startsWith(".."), name).toBe(false);
    const paths = {
      ...Object.fromEntries(
        Object.entries(productPaths)
          .filter(([name]) => content.has(name))
          .map(([name, resolver]) => [name, resolver()]),
      ),
      runtime: runtime(),
      scratch: productScratchPath(runtime()),
      serviceToken: hostContextTokenPath(runtime(), "environment-proof"),
      skillsHome: resolvePeaProductHomePath(),
    };
    for (const [name, path] of Object.entries(paths)) {
      const child = relative(home, path);
      expect(
        !isAbsolute(child) &&
          child !== ".." &&
          !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`),
        `${name}: ${path}`,
      ).toBe(true);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Work, Page state and the agent's working directory are machine state under the state root", () => {
  const state = join(hostOwnership.rootPath, "state");
  const agent = productPaths.productAgentPath();
  expect(agent).toBe(join(state, "Agent"));
  expect(productPaths.productRouteWorkPath()).toBe(join(state, "Work"));
  expect(productPaths.productPageStatePath()).toBe(join(state, "Pages"));
  expect(productPaths.productT3Path()).toBe(join(state, "T3"));
  // The harness projections follow the agent's working directory, and the Pea world is that directory.
  for (const path of resolvePeaSkillPaths(agent))
    expect(relative(agent, path).startsWith(".."), path).toBe(false);
  const { world } = Effect.runSync(getHostStatus({ connected: false }));
  expect(world.root).toBe(agent);
  expect(world.id).toBe(`pea:${Buffer.from(agent).toString("base64url")}`);
});

test("without an isolated home, the agent's working directory is never under a content home", () => {
  const user = "C:\\Users\\Alice\\OneDrive\\Documents\\Pe.Tools";
  const shared = "S:\\Pe.Tools";
  const under = (home: string, path: string) => {
    const away = relative(home, path);
    return !isAbsolute(away) && away !== ".." && !away.startsWith(`..${sep}`);
  };
  for (const [lane, owner] of [
    ["installed", "C:\\Users\\Alice\\AppData\\Local\\Positive Energy\\Pe.Tools"],
    ["dev", "C:\\src\\Pe.Tools"],
  ] as const) {
    const agent = join(stateRoot(lane, owner, undefined, shared, user), "state", "Agent");
    for (const home of [user, shared]) expect(under(home, agent), `${lane}: ${agent}`).toBe(false);
  }
  // The sentinel: the check does see a path inside a home, and such a state root never resolves.
  expect(under(user, join(user, "state", "Agent"))).toBe(true);
  expect(() => stateRoot("installed", join(user, "install"), undefined, shared, user)).toThrow(
    "user content root",
  );
  expect(() => stateRoot("dev", join(shared, "checkout"), undefined, shared, user)).toThrow(
    "PE_TOOLS_SHARED_ROOT",
  );
});
