import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
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

// Most tests here compute paths from invented roots and touch no disk, so the test-isolation
// tripwire (which only polices real resolution) stands down for this file.
beforeEach(() => vi.stubEnv("PE_TEST_HOME_ROOT", ""));
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
