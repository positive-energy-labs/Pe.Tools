import { afterEach, vi } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serviceFilePath } from "@pe/host-contracts/pe-service";
import { resolveLaneAndRoot } from "../src/shared/host-config.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A same-owner discovery receipt for the controlled HTTP transport each test substitutes. */
export function fakeRuntimeHost(base = "http://127.0.0.1:19999"): string {
  const url = new URL(base);
  if (url.hostname !== "127.0.0.1" || !url.port)
    throw Error("The fake host needs an exact loopback port.");
  const owner = resolveLaneAndRoot();
  const local = mkdtempSync(join(tmpdir(), "pe-fake-runtime-host-"));
  roots.push(local);
  vi.stubEnv("LOCALAPPDATA", local);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", ""); // this fixture is the LOCALAPPDATA-rooted lane
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", base);
  const path = serviceFilePath(join(local, "Positive Energy", "Pe.Tools"), owner.serviceName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 3,
      instanceId: "controlled-test-transport",
      processStartUtc: new Date().toISOString(),
      pid: process.pid,
      port: Number(url.port),
      lane: owner.lane,
      sourceRoot: owner.sourceRoot,
      version: "test",
      token: "test",
    }),
  );
  return base;
}
