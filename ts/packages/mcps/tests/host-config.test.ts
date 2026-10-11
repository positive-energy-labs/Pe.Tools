import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, test, vi } from "vite-plus/test";
import { checkoutRootFrom, sourceHostServiceName } from "@pe/host-contracts/service-identity";
import { discoverHostBaseUrl, resolveLaneAndRoot } from "../src/shared/host-config.ts";
import { serviceFilePath } from "@pe/host-contracts/pe-service";

let appBase: string;
const sourceRoot = checkoutRootFrom(import.meta.dirname)!;
beforeEach(() => {
  appBase = mkdtempSync(join(tmpdir(), "pe-runtime-discovery-"));
  vi.stubEnv("LOCALAPPDATA", appBase);
  vi.stubEnv("PE_LANE", "dev");
  vi.stubEnv("PE_TOOLS_SOURCE_ROOT", "");
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "");
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(appBase, { recursive: true, force: true });
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

test("checkoutRootFrom walks up to the .git + Pe.Tools.slnx root", () => {
  const root = fakeCheckout();
  expect(checkoutRootFrom(join(root, "ts", "deep"))).toBe(root);
  expect(checkoutRootFrom(root)).toBe(root);
});

test("checkoutRootFrom returns null outside any checkout", () => {
  expect(checkoutRootFrom(mkdtempSync(join(tmpdir(), "pe-not-a-checkout-")))).toBeNull();
});

test("unknown URL hosts refuse without a service receipt", () => {
  expect(() => discoverHostBaseUrl("http://127.0.0.1:9999")).toThrow(/verified service/);
  expect(() => discoverHostBaseUrl("https://example.test")).toThrow(/verified service/);
});

test("an unrecognized lane token is a hard error, never a guess", () => {
  expect(() => discoverHostBaseUrl("not-a-url-or-lane")).toThrowError(/neither a URL/);
});

test("a worktree-path token outside a checkout is a hard error", () => {
  const stray = mkdtempSync(join(tmpdir(), "pe-stray-"));
  expect(() => discoverHostBaseUrl(stray)).toThrowError(/neither a URL/);
});

test("checkout CLI refuses installed and other checkout selectors", () => {
  expect(() => discoverHostBaseUrl("installed")).toThrow(/checkout CLI/);
  expect(() => discoverHostBaseUrl(fakeCheckout())).toThrow(/Runtime checkout/);
});

test("missing host never falls back to a default port", () => {
  expect(discoverHostBaseUrl()).toBeNull();
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
