import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { claimServiceHost, type ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import {
  createServiceFile,
  discoverService,
  readServiceFile,
  writeServiceFile,
} from "@pe/host-contracts/pe-service";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { chooseServicePort } from "@pe/host-contracts/pe-service-host";
import { hostServiceName } from "@pe/host-contracts/service-identity";
import { installedPort, prepareHostBinding } from "../src/host-lifecycle.ts";
import type { HostOwnership } from "../src/host-ownership.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

// 2026-11-03: a test Revit's orphaned dev host held 127.0.0.1:5180 and the user's installed v0.7.30
// host refused to start. A dev host must never take the installed port or name, and a foreign holder
// of 5180 must not leave the installed user without a host.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test.skipIf(process.platform !== "win32")(
  "SDK verified discovery loses a live claimed incumbent when its identity query times out",
  async () => {
    const root = temp();
    const claimed = await claimServiceHost(root, {
      name: "host",
      lane: "installed",
      version: "0.7.31",
      port: installedPort,
      executablePath: process.execPath,
      shutdown: "/admin/shutdown",
      policy: { evicts: [] },
    });
    if (!claimed.claimed) throw Error(claimed.reason);
    try {
      expect(await discoverService(root, "host")).toEqual(claimed.handle.serviceFile);
      vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
        const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
        callback(Error("identity query timed out"), "", "");
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);
      // SDK pe-service.ts recordedProcessAlive treats an unreadable identity as no live owner.
      expect(await discoverService(root, "host", { verifyOwner: true })).toBeNull();
      expect(execFile).toHaveBeenLastCalledWith(
        "powershell",
        expect.arrayContaining(["-NoProfile", "-NonInteractive"]),
        { timeout: 3_000, windowsHide: true },
        expect.any(Function),
      );
      expect(await readServiceFile(root, "host")).toEqual(claimed.handle.serviceFile);
      expect(await discoverService(root, "host")).toEqual(claimed.handle.serviceFile);
    } finally {
      await claimed.handle.release();
    }
  },
);

test("a second installed launch waits for the booting host and leaves its request running", async () => {
  const ownership = { ...owner("installed", temp()), executablePath: process.execPath };
  let finishRequest!: () => void;
  let requestEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    requestEntered = resolve;
  });
  const finish = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  let shutdowns = 0;
  const servers: ReturnType<typeof createServer>[] = [];
  const claims: ServiceHostHandle[] = [];
  const first = createServer(async (request, response) => {
    if (request.url === "/call") {
      requestEntered();
      await finish;
      response.end("completed by first host");
    } else {
      if (request.url === "/admin/shutdown") shutdowns++;
      response.end("ok");
    }
  });
  servers.push(first);
  first.listen(0, "127.0.0.1");
  await once(first, "listening");
  const address = first.address();
  if (!address || typeof address === "string") throw Error("no TCP listener");
  const call = fetch(`http://127.0.0.1:${address.port}/call`);
  await entered;
  // Hold the real first claim until the second launch has observed the bind-without-record window.
  let sawBootWindow!: () => void;
  const bootWindow = new Promise<void>((resolve) => {
    sawBootWindow = resolve;
  });
  const dependencies = {
    ...machine(new Map()),
    discover: discoverService,
    portAvailable: async () => false,
    occupants: async () => {
      sawBootWindow();
      return [{ pid: process.pid, executable: process.execPath }];
    },
  };
  const descriptor = (port: number) => ({
    name: ownership.serviceName,
    lane: "installed",
    version: "0.7.31",
    port,
    executablePath: process.execPath,
    health: "/health",
    shutdown: "/admin/shutdown",
    policy: { evicts: [] },
  });
  try {
    const secondLaunch = prepareHostBinding(false, "0.7.31", ownership, dependencies);
    await bootWindow;
    const claimed = await claimServiceHost(ownership.rootPath, descriptor(address.port));
    if (!claimed.claimed) throw Error(claimed.reason);
    claims.push(claimed.handle);
    const binding = await secondLaunch;
    if (typeof binding === "number") {
      const second = createServer((_request, response) => response.end("second"));
      servers.push(second);
      second.listen(binding === installedPort ? address.port : binding, "127.0.0.1");
      await once(second, "listening");
    }
    finishRequest();
    expect(await (await call).text()).toBe("completed by first host");
    expect(shutdowns).toBe(0);
    expect(servers).toHaveLength(1);
    expect(binding).toEqual(claimed.handle.serviceFile);
  } finally {
    finishRequest();
    await call;
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const claim of claims) await claim.release();
  }
}, 15_000);
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
    readRecord: readServiceFile,
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

test("an installed host binds a free port when a foreign process holds 5180", async () => {
  const held = new Map([[installedPort, "C:\\Program Files\\nodejs\\node.exe"]]);
  expect(await prepareHostBinding(false, "0.7.31", owner("installed", temp()), machine(held))).toBe(
    0,
  );
});

test("an installed launch binds a free port when the owner census fails", async () => {
  const dependencies = {
    ...machine(new Map([[installedPort, "foreign.exe"]])),
    occupants: async () => {
      throw Error("process exited during census");
    },
    sleep: async () => {
      throw Error("a failed census must skip the boot-window wait");
    },
  };
  expect(await prepareHostBinding(false, "0.7.31", owner("installed", temp()), dependencies)).toBe(0);
});

test("an installed launch binds a free port after its peer never publishes a record", async () => {
  const ownership = owner("installed", temp());
  const waits: number[] = [];
  const dependencies = {
    ...machine(new Map([[installedPort, ownership.executablePath]])),
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  expect(await prepareHostBinding(false, "0.7.31", ownership, dependencies)).toBe(0);
  expect(waits).toEqual(Array(60).fill(500));
});

test("an installed launch refuses an unverifiable recorded peer after the boot-window wait", async () => {
  const ownership = owner("installed", temp());
  const file = createServiceFile(53123, "0.7.31", "installed", "token", ownership.executablePath);
  await writeServiceFile(ownership.rootPath, ownership.serviceName, file);
  const waits: number[] = [];
  const dependencies = {
    ...machine(new Map([[installedPort, ownership.executablePath]])),
    discover: vi.fn(async () => null),
    occupants: async () => [{ pid: file.pid, executable: ownership.executablePath }],
    choosePort: vi.fn(),
    retire: vi.fn(),
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  await expect(prepareHostBinding(false, "0.7.31", ownership, dependencies)).rejects.toThrow(
    `Installed host refused: service '${ownership.serviceName}' has an unverifiable record (pid ${file.pid}, executable ${ownership.executablePath}, service '${ownership.serviceName}') on port ${file.port}. The first host keeps serving.`,
  );
  expect(waits).toEqual(Array(60).fill(500));
  expect(dependencies.discover).toHaveBeenCalledTimes(62);
  expect(dependencies.discover).toHaveBeenLastCalledWith(ownership.rootPath, ownership.serviceName, {
    verifyOwner: true,
  });
  expect(dependencies.choosePort).not.toHaveBeenCalled();
  expect(dependencies.retire).not.toHaveBeenCalled();
  expect(await readServiceFile(ownership.rootPath, ownership.serviceName)).toEqual(file);
});

test("an installed launch binds 5180 as soon as its recordless peer frees the port", async () => {
  const ownership = owner("installed", temp());
  const waits: number[] = [];
  let discoveries = 0;
  const dependencies = {
    ...machine(new Map([[installedPort, ownership.executablePath]])),
    discover: async () => {
      discoveries++;
      return null;
    },
    portAvailable: async (port: number) => {
      expect(port).toBe(installedPort);
      return waits.length > 0;
    },
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  expect(await prepareHostBinding(false, "0.7.31", ownership, dependencies)).toBe(installedPort);
  // Returning 5180 only at the tail after the full wait is also a regression.
  expect(waits).toEqual([500]);
  expect(discoveries).toBe(3);
});

test.each([false, true])(
  "an older verified incumbent is retired after discovery (boot window: %s)",
  async (bootWindow) => {
    const ownership = owner("installed", temp());
    const file = createServiceFile(
      installedPort,
      "0.7.30",
      "installed",
      "token",
      ownership.executablePath,
    );
    let shutdowns = 0;
    let discoveries = 0;
    let aliveChecks = 0;
    const waits: number[] = [];
    const dependencies = {
      ...machine(new Map()),
      discover: async () => (++discoveries === 1 && bootWindow ? null : file),
      portAvailable: async () => shutdowns === 1 && aliveChecks === 2,
      occupants: async () => [{ pid: file.pid, executable: ownership.executablePath }],
      retire: async (incumbent: typeof file) => {
        expect(incumbent).toEqual(file);
        shutdowns++;
      },
      alive: (pid: number) => {
        expect(pid).toBe(file.pid);
        expect(shutdowns).toBe(1);
        return ++aliveChecks === 1;
      },
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    };
    expect(await prepareHostBinding(false, "0.7.31", ownership, dependencies)).toBe(installedPort);
    expect(shutdowns).toBe(1);
    expect(aliveChecks).toBe(2);
    expect(waits).toEqual([1_000]);
  },
);

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
