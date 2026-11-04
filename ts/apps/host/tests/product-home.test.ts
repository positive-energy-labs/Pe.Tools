import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { join, relative, isAbsolute } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolvePeaProductHomePath, resolvePeaSkillPaths } from "@pe/mcps";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostContextTokenPath,
  productRoot,
  productScratchPath,
} from "@pe/host-contracts/service-identity";
import * as productPaths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";

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
