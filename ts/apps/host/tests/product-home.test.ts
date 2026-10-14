import { afterEach, expect, test, vi } from "vite-plus/test";
import { join, relative, isAbsolute } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolvePeaProductHomePath, resolvePeaSkillPaths } from "@pe/mcps";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  hostContextTokenPath,
  productRoot,
  productScratchPath,
} from "@pe/host-contracts/service-identity";
import * as productPaths from "../src/product-paths.ts";
import {
  productAccessPath,
  productApsCredentialsPath,
  productApsTokensPath,
  productHarnessThreadsPath,
  productPagesRootPath,
  productPeaWorkPath,
  productPodsRootPath,
  productProvidersPath,
  productRouteWorkPath,
  productUserContentRootPath,
} from "../src/product-paths.ts";

afterEach(() => vi.unstubAllEnvs());

test("every production resolver output follows one locally selected product environment", () => {
  const home = mkdtempSync(join(tmpdir(), "pe-environment-"));
  vi.stubEnv(productPathNames.productHomeVariable, home);
  try {
    const paths = {
      ...Object.fromEntries(
        Object.entries(productPaths).map(([name, resolver]) => [name, resolver()]),
      ),
      runtime: productRoot(),
      scratch: productScratchPath(),
      serviceToken: hostContextTokenPath("environment-proof"),
      world: resolvePeaProductHomePath(),
      ...Object.fromEntries(resolvePeaSkillPaths().map((path, i) => [`skill${i}`, path])),
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

// F6 (acceptance round 3): one override names the whole product home. Pods followed a second
// "documents root" variable while Pea's world followed this one, so an isolated run migrated and
// wrote into the owner's real OneDrive home. The retired variable is set to a decoy here: nothing
// may resolve under it, and nothing may resolve outside the override.
test("with the product home override set, every product path lives under it and nowhere else", () => {
  const home = join("C:", "isolated", "Pe.Tools");
  const decoy = join("C:", "owner", "OneDrive", "Documents");
  vi.stubEnv(productPathNames.productHomeVariable, home);
  vi.stubEnv("PE_TOOLS_DOCUMENTS_ROOT", decoy);
  const paths = {
    content: productUserContentRootPath(),
    pods: productPodsRootPath(),
    pages: productPagesRootPath(),
    world: resolvePeaProductHomePath(),
    skills: resolvePeaSkillPaths().join("|"),
  };
  expect(paths.content).toBe(home);
  expect(paths.pods).toBe(join(home, "Pods"));
  expect(paths.pages).toBe(join(home, "Pages"));
  expect(paths.world).toBe(home);
  for (const [name, path] of Object.entries(paths)) {
    expect(path.startsWith(home), `${name} ${path}`).toBe(true);
    expect(path.includes(decoy), `${name} ${path}`).toBe(false);
  }
});

// ADV2-S4: acceptance hosts on worktrees shared the owner's `%LOCALAPPDATA%` state, and a schema
// skew broke the owner's host start. The one override roots machine-local state too, under
// `<override>\.local-state`, so nothing a Pe.Tools process owns can resolve outside the override.
test("with the product home override set, machine-local state lives under it, not LOCALAPPDATA", () => {
  const home = join("C:", "isolated", "Pe.Tools");
  const decoy = join("C:", "owner", "AppData", "Local");
  vi.stubEnv(productPathNames.productHomeVariable, home);
  vi.stubEnv("LOCALAPPDATA", decoy);
  const state = join(home, ".local-state");
  const paths = {
    root: productRoot(),
    token: hostContextTokenPath("host-source-test"),
    providers: productProvidersPath(),
    access: productAccessPath(),
    apsCredentials: productApsCredentialsPath(),
    apsTokens: productApsTokensPath(),
    threads: productHarnessThreadsPath(),
    routeWork: productRouteWorkPath(),
    peaWork: productPeaWorkPath(),
  };
  expect(paths.root).toBe(state);
  expect(paths.providers).toBe(join(state, "state", "providers.json"));
  for (const [name, path] of Object.entries(paths)) {
    expect(path.startsWith(state), `${name} ${path}`).toBe(true);
    expect(path.includes(decoy), `${name} ${path}`).toBe(false);
  }
});

test("without the override, machine-local state stays under LOCALAPPDATA", () => {
  const local = join("C:", "owner", "AppData", "Local");
  vi.stubEnv(productPathNames.productHomeVariable, "");
  vi.stubEnv("LOCALAPPDATA", local);
  expect(productRoot()).toBe(join(local, "Positive Energy", "Pe.Tools"));
  expect(productProvidersPath()).toBe(
    join(local, "Positive Energy", "Pe.Tools", "state", "providers.json"),
  );
});
