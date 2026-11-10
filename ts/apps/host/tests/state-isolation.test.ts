import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

let root: string;
let installed: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-host-isolation-"));
  installed = join(root, "local", "Positive Energy", "Pe.Tools");
  vi.stubEnv("LOCALAPPDATA", join(root, "local"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "home"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(root, { recursive: true, force: true });
});

// The host's root is computed once at module load (ISOFIX-R), so each test imports after its env stub.
test("the production Work resolver honors the dev home", async () => {
  const { productRouteWorkPath } = await import("../src/product-paths.ts");
  expect(productRouteWorkPath()).toBe(join(root, "home", "Work"));
});

// ISOFIX-R dropped junction resolution (canonicalPath) by ruling; a home inside installed state still refuses.
test("startup refuses a dev home inside installed state before host code runs", async () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", installed);
  await expect(import("../src/host-ownership.ts")).rejects.toThrow("installed product state");
});

test("source startup cannot claim the installed lane", async () => {
  vi.stubEnv("PE_LANE", "installed");
  await expect(import("../src/host-ownership.ts")).rejects.toThrow("Installed host");
});
