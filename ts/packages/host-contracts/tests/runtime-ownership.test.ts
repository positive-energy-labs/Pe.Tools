import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { productInstallLayout } from "../src/contracts/product.ts";
import {
  documentsUserRoot,
  firmHome,
  firmKeysPath,
  firmSettingsDir,
  homes,
  markerTier,
  machineFacts,
  sharedDriveRoot,
  type Home,
  type HomeFacts,
  type HomeTier,
} from "../src/product-paths.ts";
import {
  installedRuntimeRoot,
  productRoot,
  stateRoot,
  stateTree,
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
    userRoot?: string;
    stateRoot?: string;
    error?: string;
  }[];
  markers: { name: string; text: string; tier: HomeTier | null }[];
  homes: {
    name: string;
    productHome: string | null;
    sharedRoot: string | null;
    drives: string[];
    folders: Record<string, string[]>;
    markerFiles: Record<string, string>;
    pointer: string | null;
    user: string;
    project: string | null;
    firm: string | null;
    sharedDriveRoot: string | null;
    firmConflict: string[];
    homes: string[];
    firmSettings: string | null;
    firmPreferences: string | null;
    firmKeys: string | null;
  }[];
  stateTree: (Record<
    "name" | "stateRoot" | "podId" | "runId" | "pageSlug" | "blobSha256" | "work" | "pageState",
    string
  > &
    Record<"run" | "podlessRuns" | "blob" | "t3" | "agent", string>)[];
  trayLaunches: { name: string; owner: RuntimeOwner; launch: string[]; argv: string[] }[];
};

test.each(fixture.stateRoots)("state root: $name", (row) => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", row.productHome ?? undefined);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", row.sharedRoot ?? undefined);
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  const resolvers = [
    () =>
      stateRoot(row.lane, row.ownerRoot, row.productHome ?? undefined, [
        ...(row.userRoot ? [{ tier: "user", root: row.userRoot } satisfies Home] : []),
        ...(row.sharedRoot ? [{ tier: "firm", root: row.sharedRoot } satisfies Home] : []),
      ]),
    // A fixture user root is not this machine's Documents: only the pure resolver can take it.
    ...(row.userRoot
      ? []
      : [
          () =>
            productRoot({ lane: row.lane, sourceRoot: row.ownerRoot, installedRoot: row.ownerRoot }),
        ]),
  ];
  for (const resolve of resolvers) {
    if (row.error) expect(resolve).toThrow(row.error);
    else expect(resolve()).toBe(row.stateRoot);
  }
});

test.each(fixture.markers)("marker: $name", (row) => {
  expect(markerTier(row.text)).toBe(row.tier);
});

const factsOf = (row: (typeof fixture.homes)[number]): HomeFacts => ({
  drives: row.drives,
  list: (directory) => row.folders[directory] ?? [],
  marker: (folder) => row.markerFiles[folder] ?? null,
});

test.each(fixture.homes)("homes: $name", (row) => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", row.productHome ?? undefined);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", row.sharedRoot ?? undefined);
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  const at = (path: string) => path.replace("%DOCUMENTS%", dirname(documentsUserRoot()));
  const facts = factsOf(row);
  const list = homes({ pointer: row.pointer, facts });
  const of = (tier: HomeTier) => list.find((home) => home.tier === tier)?.root ?? null;
  expect(list.map((home) => home.root)).toEqual(row.homes.map(at));
  expect(of("user")).toBe(at(row.user));
  expect(of("project")).toBe(row.project);
  expect(of("firm")).toBe(row.firm);
  expect(firmHome(facts).root).toBe(row.firm);
  expect(firmHome(facts).refused ?? []).toEqual(row.firmConflict);
  expect(sharedDriveRoot(facts)).toBe(row.sharedDriveRoot);
  expect(firmSettingsDir(facts)).toBe(row.firmSettings);
  expect(firmSettingsDir(facts) && join(firmSettingsDir(facts)!, "preferences.json")).toBe(
    row.firmPreferences,
  );
  expect(firmKeysPath(facts)).toBe(row.firmKeys);
});

test.each(fixture.stateTree)("state tree: $name", (row) => {
  const tree = stateTree(row.stateRoot);
  expect({
    work: tree.work,
    pageState: join(tree.pages, row.pageSlug),
    run: join(tree.runs, row.podId, row.runId),
    podlessRuns: tree.podlessRuns,
    blob: join(tree.blobs, "sha256", row.blobSha256),
    t3: tree.t3,
    agent: tree.agent,
  }).toEqual({
    work: row.work,
    pageState: row.pageState,
    run: row.run,
    podlessRuns: row.podlessRuns,
    blob: row.blob,
    t3: row.t3,
    agent: row.agent,
  });
});

test.each(fixture.trayLaunches)("tray argv: $name", (row) => {
  expect([...trayOwnerArguments(row.owner), ...row.launch]).toEqual(row.argv);
});

let root: string;
let installed: string;

test("a cached firm probe rechecks its marker without rescanning the injected drive list", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  const shared = join(root, "04 PE Software Files", "Pe.Tools");
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, "pe-home.json"), '{"tier":"firm"}');
  const disk = machineFacts([root]);
  const facts = { ...disk, list: vi.fn(disk.list) };
  expect(firmHome(facts).root).toBe(shared);
  expect(firmHome(facts).root).toBe(shared);
  expect(facts.list).toHaveBeenCalledTimes(1);
  renameSync(join(shared, "pe-home.json"), join(shared, "marker-away.json"));
  expect(firmHome(facts).root).toBeNull();
  expect(firmSettingsDir(facts)).toBeNull();
  expect(facts.list).toHaveBeenCalledTimes(1);
  renameSync(join(shared, "marker-away.json"), join(shared, "pe-home.json"));
  expect(firmHome(facts).root).toBeNull();
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
  try {
    expect(firmHome(facts).root).toBe(shared);
    expect(facts.list).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-isofix-"));
  const local = join(root, "Users", "owner", "AppData", "Local");
  installed = join(local, "Positive Energy", "Pe.Tools");
  vi.stubEnv("LOCALAPPDATA", local);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", undefined);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", join(root, "no-firm")); // a told, unmarked firm replaces the probe: no real G: drive
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
