import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { productInstallLayout } from "../src/contracts/product.ts";
import { productHomePath } from "../src/product-paths.ts";
import {
  installedRuntimeRoot,
  productRoot,
  stateRoot,
  trayOwnerArguments,
  type RuntimeOwner,
} from "../src/service-identity.ts";

// Shared with C# RuntimeOwnershipTests / Pe.Host.Tray ParseOwner tests and the PowerShell helper test.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "runtime-ownership.fixture.json"), "utf8"),
) as {
  stateRoots: {
    name: string;
    lane: "dev" | "installed";
    ownerRoot: string;
    productHome: string | null;
    sharedRoot?: string | null;
    stateRoot?: string;
    error?: string;
  }[];
  contentRoots: {
    name: string;
    productHome: string | null;
    sharedRoot: string | null;
    contentRoot?: string;
    error?: string;
  }[];
  trayLaunches: { name: string; owner: RuntimeOwner; launch: string[]; argv: string[] }[];
};

test.each(fixture.stateRoots)("state root: $name", (row) => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", row.productHome ?? undefined);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", row.sharedRoot ?? undefined);
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  const resolvers = [
    () =>
      stateRoot(row.lane, row.ownerRoot, row.productHome ?? undefined, row.sharedRoot ?? undefined),
    () => productRoot({ lane: row.lane, sourceRoot: row.ownerRoot, installedRoot: row.ownerRoot }),
  ];
  for (const resolve of resolvers) {
    if (row.error) expect(resolve).toThrow(row.error);
    else expect(resolve()).toBe(row.stateRoot);
  }
});

test.each(fixture.contentRoots)("content root: $name", (row) => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", row.productHome ?? undefined);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", row.sharedRoot ?? undefined);
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  if (row.error) expect(productHomePath).toThrow(row.error);
  else expect(productHomePath()).toBe(row.contentRoot);
});

test.each(fixture.trayLaunches)("tray argv: $name", (row) => {
  expect([...trayOwnerArguments(row.owner), ...row.launch]).toEqual(row.argv);
});

let root: string;
let installed: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-isofix-"));
  const local = join(root, "Users", "owner", "AppData", "Local");
  installed = join(local, "Positive Energy", "Pe.Tools");
  vi.stubEnv("LOCALAPPDATA", local);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const writeManifest = (at: string, product = "Pe.Tools") => {
  mkdirSync(at, { recursive: true });
  writeFileSync(
    join(at, "product.payloads.json"),
    JSON.stringify({ product, vendor: "Positive Energy" }),
  );
};

test("an installed executable's root is the install its manifest names, not LOCALAPPDATA", () => {
  // The SDK install sits under a different spelling than the env var: the executable's install wins.
  const sdkRoot = join(root, "Profile", "Positive Energy", "Pe.Tools");
  writeManifest(sdkRoot);
  const host = join(sdkRoot, productInstallLayout["VersionedApp:host"]);
  expect(installedRuntimeRoot("host", host, true)).toBe(sdkRoot);
  expect(productRoot({ lane: "installed", sourceRoot: null, installedRoot: sdkRoot })).toBe(
    sdkRoot,
  );
});

test("an installed executable without its SDK manifest, or outside the bundle, refuses", () => {
  const host = join(installed, productInstallLayout["VersionedApp:host"]);
  expect(() => installedRuntimeRoot("host", host, true)).toThrow("SDK install");
  writeManifest(installed, "Other.Product");
  expect(() => installedRuntimeRoot("host", host, true)).toThrow("another product");
  writeManifest(installed);
  expect(() => installedRuntimeRoot("host", host, false)).toThrow("Installed host");
  expect(() => installedRuntimeRoot("host", join(dirname(host), "copy.exe"), true)).toThrow(
    "SDK install",
  );
});

test("an installed runtime still refuses a product home override (v0.7.30 behaviour)", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "home"));
  expect(() =>
    productRoot({ lane: "installed", sourceRoot: null, installedRoot: installed }),
  ).toThrow("PE_TOOLS_PRODUCT_HOME");
});

test("a dev override cannot point at or under installed state", () => {
  const checkout = join(root, "checkout");
  const dev: RuntimeOwner = { lane: "dev", sourceRoot: checkout, installedRoot: null };
  expect(productRoot(dev)).toBe(join(checkout, ".artifacts", "pe-tools"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "home"));
  expect(productRoot(dev)).toBe(join(root, "home", ".local-state"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", installed);
  expect(() => productRoot(dev)).toThrow("installed product state");
  expect(() => productRoot({ lane: "dev", sourceRoot: null, installedRoot: null })).toThrow(
    "not told",
  );
});
