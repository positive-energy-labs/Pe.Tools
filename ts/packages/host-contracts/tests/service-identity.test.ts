import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { productInstallLayout } from "../src/contracts/product.ts";
import { installedRuntimeRoot, productRoot } from "../src/service-identity.ts";

let root: string;
let checkout: string;
let installed: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-isofix-"));
  checkout = join(root, "checkout");
  mkdirSync(checkout);
  writeFileSync(join(checkout, ".git"), "gitdir: unused-fixture");
  writeFileSync(join(checkout, "Pe.Tools.slnx"), "");
  const local = join(root, "Users", "owner", "AppData", "Local");
  installed = join(local, "Positive Energy", "Pe.Tools");
  vi.stubEnv("LOCALAPPDATA", local);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", undefined);
  vi.stubEnv("PE_TOOLS_SOURCE_ROOT", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

test("a checkout with the ordinary environment gets checkout state, never installed state", () => {
  expect(productRoot("dev", checkout)).toBe(join(checkout, ".artifacts", "pe-tools"));
  expect(productRoot("dev", checkout)).not.toBe(installed);
});

test("the installed host keeps its canonical AppData root", () => {
  expect(productRoot("installed")).toBe(installed);
  expect(
    installedRuntimeRoot("host", join(installed, productInstallLayout["VersionedApp:host"]), true),
  ).toBe(installed);
  expect(() => installedRuntimeRoot("host", process.execPath, false)).toThrow("Installed host");
});

test("a dev lane honors an explicit product home", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "explicit-home"));
  expect(productRoot("dev", checkout)).toBe(join(root, "explicit-home", ".local-state"));
});

test("a dev override cannot alias or descend into installed state", () => {
  mkdirSync(installed, { recursive: true });
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", installed);
  expect(() => productRoot("dev", checkout)).toThrow("installed product state");
  const home = join(root, "linked-home");
  mkdirSync(home);
  symlinkSync(installed, join(home, ".local-state"), "junction");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  expect(() => productRoot("dev", checkout)).toThrow("installed product state");
});

test("a dev root must be a checkout, even with an explicit product home", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "explicit-home"));
  expect(() => productRoot("dev", root)).toThrow("checkout");
});
