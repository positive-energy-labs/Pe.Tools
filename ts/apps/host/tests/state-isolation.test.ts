import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { productRouteWorkPath } from "../src/product-paths.ts";

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

test("the production Work resolver honors the dev home", () => {
  expect(productRouteWorkPath()).toBe(join(root, "home", ".local-state", "state", "route-work"));
});

test("startup refuses a dev home junction to installed state before host code runs", async () => {
  mkdirSync(installed, { recursive: true });
  mkdirSync(join(root, "home"));
  symlinkSync(installed, join(root, "home", ".local-state"), "junction");
  await expect(import("../src/host-ownership.ts")).rejects.toThrow("installed product state");
  expect(() => productRouteWorkPath()).toThrow("installed product state");
});

test("source startup cannot claim the installed lane", async () => {
  vi.stubEnv("PE_LANE", "installed");
  await expect(import("../src/host-ownership.ts")).rejects.toThrow("Installed host");
});
