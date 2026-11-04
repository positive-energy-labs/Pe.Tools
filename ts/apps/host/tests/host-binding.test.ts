import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { chooseServicePort } from "@pe/host-contracts/pe-service-host";
import { hostServiceName } from "@pe/host-contracts/service-identity";
import { installedPort, prepareHostBinding } from "../src/host-lifecycle.ts";
import type { HostOwnership } from "../src/host-ownership.ts";

// 2026-11-03: a test Revit's orphaned dev host held 127.0.0.1:5180 and the user's installed v0.7.30
// host refused to start. A dev host must never take the installed port or name, and a foreign holder
// of 5180 must not leave the installed user without a host.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), "pe-binding-"));
  roots.push(root);
  return root;
};

const owner = (lane: "dev" | "installed", rootPath: string): HostOwnership => ({
  executablePath: join(rootPath, "bin", "host", "Pe.Host.exe"),
  lane,
  processId: process.pid,
  serviceName: hostServiceName(lane, lane === "dev" ? "C:\\src\\Pe.Tools" : null),
  sourceRoot: lane === "dev" ? "C:\\src\\Pe.Tools" : null,
  installedRoot: lane === "installed" ? rootPath : null,
  rootPath,
});

/** One machine's listening ports, shared by every host started in a test. */
function machine(held: Map<number, string>) {
  return {
    discover: async () => null,
    choosePort: async (_appBase: string, _name: string, preferred: number) =>
      preferred > 0 && !held.has(preferred) ? preferred : 0,
    portAvailable: async (port: number) => !held.has(port),
    occupants: async (_appBase: string, port: number) =>
      held.has(port) ? [{ pid: 4242, executable: held.get(port)! }] : [],
    healthy: async () => true,
    retire: async () => {},
    sleep,
    alive: () => false,
  };
}

test("a dev host never uses the installed service name", () => {
  expect(owner("dev", temp()).serviceName).not.toBe(owner("installed", temp()).serviceName);
  expect(owner("installed", temp()).serviceName).toBe("host");
});

test("a dev host never binds the installed port, even when it is free or remembered", async () => {
  const dev = owner("dev", temp());
  // The real chooser, with 5180 remembered from an older launch: the guard still refuses it.
  mkdirSync(join(dev.rootPath, "state", "service"), { recursive: true });
  writeFileSync(join(dev.rootPath, "state", "service", `${dev.serviceName}.port`), "5180");
  const real = { ...machine(new Map()), choosePort: chooseServicePort };
  expect(await prepareHostBinding(false, "dev", dev, real)).not.toBe(installedPort);
  // A chooser that would hand out 5180 (free on this machine) is overruled to "any free port".
  const free = { ...machine(new Map()), choosePort: async () => installedPort };
  expect(await prepareHostBinding(false, "dev", dev, free)).toBe(0);
});

test("an installed host keeps 5180 when it is free (v0.7.30 behaviour)", async () => {
  expect(
    await prepareHostBinding(false, "0.7.31", owner("installed", temp()), machine(new Map())),
  ).toBe(installedPort);
});

test("an installed host binds a free port when a foreign process holds 5180", async () => {
  const held = new Map([[installedPort, "C:\\Program Files\\nodejs\\node.exe"]]);
  expect(await prepareHostBinding(false, "0.7.31", owner("installed", temp()), machine(held))).toBe(
    0,
  );
});

test.each(["dev first", "installed first"])(
  "dev and installed hosts both start (%s) and never share a port",
  async (order) => {
    const held = new Map<number, string>();
    const ports = machine(held);
    const start = async (lane: "dev" | "installed") => {
      const port = await prepareHostBinding(false, lane, owner(lane, temp()), ports);
      if (typeof port !== "number") throw Error("unexpected reuse");
      // Port 0 is an OS-assigned ephemeral port, never 5180 on Windows (49152-65535).
      const bound = port || 50000 + held.size;
      held.set(bound, lane);
      return bound;
    };
    const lanes =
      order === "dev first" ? (["dev", "installed"] as const) : (["installed", "dev"] as const);
    const bound = Object.fromEntries([
      [lanes[0], await start(lanes[0])],
      [lanes[1], await start(lanes[1])],
    ]);
    expect(bound.installed).toBe(installedPort);
    expect(bound.dev).not.toBe(installedPort);
  },
);
