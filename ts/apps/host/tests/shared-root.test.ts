import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { productHomePath } from "@pe/host-contracts/product-paths";
import * as paths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { firmFilePath } from "../src/ducts-inputs.ts";
import { productCatalogsRootPath } from "../src/duct-catalogs.ts";
import { peaMcpServer } from "../src/harness/adapter.ts";

afterEach(() => vi.unstubAllEnvs());
const under = (root: string, path: string) => {
  const away = relative(root, path);
  return !isAbsolute(away) && away !== ".." && !away.startsWith("../") && !away.startsWith("..\\");
};

test("shared content follows the mount while every machine path stays with its owner", () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", "");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  try {
    const content = new Set([
      "productUserContentRootPath",
      "productPodsRootPath",
      "productPagesRootPath",
      "productRouteWorkPath",
      "productRouteSettingsPath",
    ]);
    const { productPeaWorkPath, ...rest } = paths;
    for (const [name, resolver] of Object.entries({ productPeaWorkPath, ...rest })) {
      const path = resolver();
      expect(under(shared, path), `${name}: ${path}`).toBe(content.has(name));
      if (!content.has(name)) expect(under(hostOwnership.rootPath, path), name).toBe(true);
    }
    expect(paths.productRouteWorkPath()).toBe(join(shared, "Work"));
    expect(paths.productRouteSettingsPath()).toBe(join(shared, "settings", "routes"));
    expect(under(shared, firmFilePath())).toBe(true);
    expect(under(shared, productCatalogsRootPath())).toBe(true);
    vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(shared, "isolated"));
    expect(productHomePath()).toBe(join(shared, "isolated"));
  } finally {
    rmSync(shared, { recursive: true, force: true });
  }
});

test("missing content configuration refuses and names the shared root variable", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", "");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  vi.stubEnv("PE_TEST_HOME_ROOT", ""); // allow the old Documents resolver to reach this falsifier
  expect(() => productHomePath()).toThrow("PE_TOOLS_SHARED_ROOT");
});

test("the harness declares the shared mount for its MCP child", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", "");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", " S:\\Pe.Tools ");
  expect(peaMcpServer(null, "http://localhost:1234", "test").env).toContainEqual({
    name: "PE_TOOLS_SHARED_ROOT",
    value: "S:\\Pe.Tools",
  });
});
