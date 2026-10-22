import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, test, vi } from "vite-plus/test";
import {
  checkoutRootFrom,
  sourceHostServiceName,
  productRoot,
} from "@pe/host-contracts/service-identity";
import { productInstallLayout } from "@pe/host-contracts/contracts";
import { discoverHostBaseUrl, resolveLaneAndRoot } from "../src/shared/host-config.ts";
import { serviceFilePath } from "@pe/host-contracts/pe-service";
import { contextFetch } from "@pe/runtime/context";

const { sea } = vi.hoisted(() => ({ sea: { bundled: false } }));
vi.mock("node:sea", async (original) => ({
  ...(await original<typeof import("node:sea")>()),
  isSea: () => sea.bundled,
}));
const executable = process.execPath;

let appBase: string;
const sourceRoot = checkoutRootFrom(import.meta.dirname)!;
beforeEach(() => {
  appBase = mkdtempSync(join(tmpdir(), "pe-runtime-discovery-"));
  vi.stubEnv("LOCALAPPDATA", appBase);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", ""); // the LOCALAPPDATA-rooted lane
  vi.stubEnv("PE_LANE", "dev");
  vi.stubEnv("PE_TOOLS_SOURCE_ROOT", "");
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "");
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", "");
});
afterEach(() => {
  process.execPath = executable;
  sea.bundled = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(appBase, { recursive: true, force: true });
});

test.each(["host", "pea"] as const)(
  "canonical installed %s SEA resolves the same installed owner",
  (role) => {
    sea.bundled = true;
    vi.stubEnv("PE_LANE", "installed");
    process.execPath = join(productRoot(), productInstallLayout[`VersionedApp:${role}`]);
    expect(resolveLaneAndRoot()).toEqual({
      lane: "installed",
      sourceRoot: null,
      serviceName: "host",
      installedRoot: productRoot(),
    });
  },
);

test.each(["Pe.Host.exe", "pea.exe"])(
  "copied %s SEA never authorizes installed context",
  (name) => {
    sea.bundled = true;
    vi.stubEnv("PE_LANE", "installed");
    process.execPath = join(appBase, name);
    expect(() => resolveLaneAndRoot()).toThrow(/must execute/);
  },
);

test("non-SEA source cannot claim installed even with canonical host executable spelling", () => {
  vi.stubEnv("PE_LANE", "installed");
  process.execPath = join(productRoot(), productInstallLayout["VersionedApp:host"]);
  expect(() => resolveLaneAndRoot()).toThrow(/Source CLI code/);
});

test("installed host contextFetch stamps its canonical installed owner", async () => {
  sea.bundled = true;
  vi.stubEnv("PE_LANE", "installed");
  process.execPath = join(productRoot(), productInstallLayout["VersionedApp:host"]);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await contextFetch("http://127.0.0.1:19999/host/status");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-pe-runtime-service")).toBe("host");
});
function receipt(patch: Record<string, unknown> = {}) {
  const path = serviceFilePath(
    join(appBase, "Positive Energy", "Pe.Tools"),
    sourceHostServiceName(sourceRoot),
  );
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 3,
      instanceId: "test-owner",
      processStartUtc: new Date().toISOString(),
      pid: process.pid,
      port: 19999,
      lane: "dev",
      version: "test",
      token: "test",
      sourceRoot,
      ...patch,
    }),
  );
}

function fakeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), "pe-host-config-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "Pe.Tools.slnx"), "");
  mkdirSync(join(root, "ts", "deep"), { recursive: true });
  return root;
}

test("unknown URL hosts refuse without a service receipt", () => {
  expect(() => discoverHostBaseUrl("http://127.0.0.1:9999")).toThrow(/verified service/);
  expect(() => discoverHostBaseUrl("https://example.test")).toThrow(/verified service/);
});

test("checkout CLI refuses installed and other checkout selectors", () => {
  expect(() => discoverHostBaseUrl("installed")).toThrow(/checkout CLI/);
  expect(() => discoverHostBaseUrl(fakeCheckout())).toThrow(/Runtime checkout/);
});
test("same checkout receipt accepts only its exact URL or checkout selector", () => {
  receipt();
  for (const selection of [undefined, "dev", sourceRoot, "http://127.0.0.1:19999"])
    expect(discoverHostBaseUrl(selection)).toBe("http://127.0.0.1:19999");
  expect(() => discoverHostBaseUrl("http://127.0.0.1:5180")).toThrow(/verified service/);
});
test.each([{ lane: "installed" }, { sourceRoot: "C:/other-checkout" }, { sourceRoot: null }])(
  "wrong/unknown receipt %j refuses",
  (patch) => {
    receipt(patch);
    expect(() => discoverHostBaseUrl()).toThrow(/Runtime/);
  },
);
test("source-root spawn plumbing cannot relabel another checkout", () => {
  vi.stubEnv("PE_TOOLS_SOURCE_ROOT", fakeCheckout());
  expect(() => discoverHostBaseUrl()).toThrow(/Runtime checkout/);
});
test("source code cannot relabel itself installed", () => {
  vi.stubEnv("PE_LANE", "installed");
  expect(() => discoverHostBaseUrl()).toThrow(/Source CLI code/);
});

test("configured capability suffix remains pinned to the actual checkout", () => {
  const base = sourceHostServiceName(sourceRoot);
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", `${base}-no-revit`);
  expect(resolveLaneAndRoot().serviceName).toBe(`${base}-no-revit`);
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", "host-source-other-no-revit");
  expect(() => resolveLaneAndRoot()).toThrow("does not belong");
});
