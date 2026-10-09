import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { ServeError } from "effect/unstable/http/HttpServerError";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { ServiceFile } from "@pe/host-contracts/pe-service";
import type { ServiceHostDescriptor } from "@pe/host-contracts/pe-service-host";
import { hostProgram } from "../src/host-program.ts";
import * as lifecycle from "../src/host-lifecycle.ts";
import type { HostOwnership } from "../src/host-ownership.ts";
import type { HttpLiveOptions } from "../src/app.ts";

const mocks = vi.hoisted(() => ({
  ownership: {
    lane: "installed",
    serviceName: "host",
    executablePath: "C:/product/Pe.Host.exe",
    processId: 77,
    sourceRoot: null,
  } as HostOwnership,
  discover: vi.fn(),
  choosePort: vi.fn(),
  occupants: vi.fn(),
  healthy: vi.fn(),
  retire: vi.fn(),
  sleep: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  dispose: vi.fn(),
  spawn: vi.fn(),
  bind: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../src/host-ownership.ts", () => ({
  hostOwnership: mocks.ownership,
  hostCapabilities: { revit: true },
  productRoot: () => "C:/product",
}));
vi.mock("@pe/host-contracts/service-identity", async (original) => ({
  ...(await original<object>()),
  productRoot: () => "C:/product",
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<object>()),
  readFileSync: () => '{"version":"new"}',
  existsSync: () => false,
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<object>()),
  spawn: mocks.spawn,
}));
vi.mock("@pe/host-contracts/pe-service", async (original) => ({
  ...(await original<object>()),
  sweepDeadServiceFiles: async () => [],
}));
vi.mock("@pe/host-contracts/pe-service-host", async (original) => ({
  ...(await original<object>()),
  claimServiceHost: mocks.claim,
  rememberServicePort: async () => {},
}));
vi.mock("@pe/runtime", () => ({ capture: () => {} }));
vi.mock("../src/update-route.ts", () => ({
  makeInstalledUpdateReader: () => ({}),
  updateWhenNoRevit: mocks.update,
}));
vi.mock("../src/app.ts", async () => {
  const { ServiceFileLive, HostLifecycle } = await import("../src/host-lifecycle.ts");
  return {
    resolveWebRoot: () => null,
    makeHttpLive: (options: HttpLiveOptions) => {
      const binding = mocks.bind(options.port) ?? Effect.void;
      return ServiceFileLive.pipe(
        Layer.provide(
          Layer.effect(
            HttpServer.HttpServer,
            Effect.as(binding, {
              address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: options.port },
              serve: () => Effect.void,
            }),
          ),
        ),
        Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
      );
    },
  };
});

const incumbent: ServiceFile = {
  schemaVersion: 3,
  instanceId: "incumbent",
  pid: 42,
  processStartUtc: "2026-10-09T00:00:00Z",
  port: 5180,
  version: "old",
  lane: "installed",
  token: "private",
  executablePath: "C:/product/Pe.Host.exe",
};
const originalPrepare = lifecycle.prepareHostBinding;
const originalArgv = process.argv;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.ownership, { lane: "installed", serviceName: "host", sourceRoot: null });
  process.argv = ["node", "host"];
  mocks.discover.mockResolvedValue(null);
  mocks.choosePort.mockResolvedValue(0);
  mocks.occupants.mockResolvedValue([]);
  mocks.healthy.mockResolvedValue(true);
  mocks.retire.mockResolvedValue(undefined);
  mocks.sleep.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(false);
  mocks.bind.mockReturnValue(undefined);
  mocks.claim.mockImplementation(async (_root: string, descriptor: ServiceHostDescriptor) => ({
    claimed: true,
    handle: {
      serviceFile: { ...incumbent, pid: 77, port: descriptor.port, lane: descriptor.lane },
      release: mocks.release,
    },
  }));
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref: vi.fn() });
    child.stdin.once("finish", () => {
      mocks.dispose();
      child.emit("close", 0);
    });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  vi.spyOn(lifecycle, "prepareHostBinding").mockImplementation((open, version) =>
    originalPrepare(open, version, mocks.ownership, {
      discover: mocks.discover,
      choosePort: mocks.choosePort,
      occupants: mocks.occupants,
      healthy: mocks.healthy,
      retire: mocks.retire,
      sleep: mocks.sleep,
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

// The frontend ends the scoped program after the claim. No listener, registry, or process is real.
async function launch() {
  await Effect.runPromise(
    hostProgram((_handle, _ready) =>
      Effect.yieldNow.pipe(Effect.andThen(Effect.die(new Error("test-stop")))),
    ),
  ).catch((error: Error) => {
    if (!error.message.includes("test-stop")) throw error;
  });
}
const trays = () => mocks.spawn.mock.calls.filter(([, args]) => args.includes("--parent-pid"));
const windows = () => mocks.spawn.mock.calls.filter(([, args]) => args.includes("start"));

test("foreign occupant refuses before bind and names pid, executable, and recorded service", async () => {
  mocks.occupants.mockResolvedValue([
    { pid: 900, executable: "C:/foreign.exe", serviceName: "other-service" },
  ]);
  await expect(launch()).rejects.toThrow(
    /5180.*pid 900, executable C:\/foreign.exe, service 'other-service'/,
  );
  expect(mocks.discover).toHaveBeenCalledWith("C:/product", "host", { verifyOwner: true });
  expect(mocks.bind).not.toHaveBeenCalled();
  expect(mocks.choosePort).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("installed start binds only 5180; tray belongs to the winning claim and disposes before release", async () => {
  await launch();
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(5180);
  expect(mocks.choosePort).not.toHaveBeenCalled();
  expect(mocks.claim.mock.calls[0]![1].policy).toEqual({ evicts: [] });
  expect(trays()).toHaveLength(1);
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.dispose.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.release.mock.invocationCallOrder[0]!,
  );
  expect(windows()).toHaveLength(0);
});

test.each([false, true])(
  "ordinary installed start reuses a same-version incumbent; open=%s",
  async (open) => {
    mocks.discover.mockResolvedValue({ ...incumbent, version: "new" });
    mocks.occupants.mockResolvedValue([
      { pid: incumbent.pid, executable: incumbent.executablePath },
    ]);
    if (open) process.argv.push("--open");
    await launch();
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.retire).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(trays()).toHaveLength(0);
    expect(windows()).toHaveLength(open ? 1 : 0);
    if (open) expect(windows()[0]![1]).toContain("http://127.0.0.1:5180/");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("'host' already serving on 5180 (pid 42)"),
    );
  },
);

test.each([false, true])(
  "ordinary installed start retires an older incumbent before binding; open=%s",
  async (open) => {
    mocks.discover.mockResolvedValue(incumbent);
    mocks.occupants
      .mockResolvedValueOnce([{ pid: 42, executable: incumbent.executablePath }])
      .mockResolvedValue([]);
    if (open) process.argv.push("--open");
    await launch();
    expect(mocks.retire).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ port: 5180, token: "private" }),
    );
    expect(console.log).toHaveBeenCalledWith("pe-host retiring old incumbent pid 42 on port 5180");
    expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(5180);
    expect(mocks.claim).toHaveBeenCalledOnce();
  },
);

test("installed start refuses an older incumbent that still owns the port", async () => {
  mocks.discover.mockResolvedValue(incumbent);
  mocks.occupants.mockResolvedValue([{ pid: 42, executable: incumbent.executablePath }]);
  await expect(launch()).rejects.toThrow(/pid 42.*version old/);
  expect(mocks.retire).toHaveBeenCalledExactlyOnceWith(incumbent);
  expect(mocks.sleep).toHaveBeenCalledTimes(15);
  expect(mocks.bind).not.toHaveBeenCalled();
});

test("installed start refuses when an older incumbent rejects shutdown", async () => {
  mocks.discover.mockResolvedValue(incumbent);
  mocks.occupants.mockResolvedValue([{ pid: 42, executable: incumbent.executablePath }]);
  mocks.retire.mockRejectedValue(new Error("shutdown returned HTTP 403"));
  await expect(launch()).rejects.toThrow(/pid 42.*version old.*failed to retire/);
  expect(mocks.bind).not.toHaveBeenCalled();
});

test.each(["wrong image", "unhealthy", "dev record"])(
  "live record is not sufficient for reuse: %s",
  async (reason) => {
    mocks.discover.mockResolvedValue({
      ...incumbent,
      lane: reason === "dev record" ? "dev" : "installed",
    });
    mocks.occupants.mockResolvedValue([
      {
        pid: 42,
        executable: reason === "wrong image" ? "C:/stranger.exe" : incumbent.executablePath,
      },
    ]);
    mocks.healthy.mockResolvedValue(reason !== "unhealthy");
    await expect(launch()).rejects.toThrow(/not a verified serving installed incumbent/);
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  },
);

test("claim loser never starts the tray or opens a window", async () => {
  process.argv.push("--open");
  mocks.claim.mockResolvedValue({ claimed: false, reason: "incumbent won the race" });
  await expect(launch()).rejects.toThrow(/claim refused: incumbent won the race/);
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(5180);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("a foreign listener winning the bind race is named, without a second bind", async () => {
  mocks.occupants
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ pid: 901, executable: "C:/racer.exe" }]);
  mocks.bind.mockReturnValue(
    Effect.fail(
      new ServeError({ cause: Object.assign(new Error("busy"), { code: "EADDRINUSE" }) }),
    ),
  );
  await expect(launch()).rejects.toThrow(/pid 901, executable C:\/racer.exe/);
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(5180);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("the installed incumbent winning the bind race opens once without a tray", async () => {
  process.argv.push("--open");
  mocks.discover.mockResolvedValueOnce(null).mockResolvedValueOnce({
    ...incumbent,
    version: "new",
  });
  mocks.occupants
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ pid: 42, executable: incumbent.executablePath }]);
  mocks.bind.mockReturnValue(
    Effect.fail(
      new ServeError({ cause: Object.assign(new Error("busy"), { code: "EADDRINUSE" }) }),
    ),
  );
  await launch();
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(5180);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(trays()).toHaveLength(0);
  expect(windows()).toHaveLength(1);
});

test("dev still accepts SDK port 0 and explicit takeover, without a tray", async () => {
  Object.assign(mocks.ownership, {
    lane: "dev",
    serviceName: "host-source-test",
    sourceRoot: "C:/checkout",
  });
  process.argv.push("--take-over-host");
  await launch();
  expect(mocks.choosePort).toHaveBeenCalledWith("C:/product", "host-source-test", 5180);
  expect(mocks.bind).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.claim.mock.calls[0]![1].policy).toEqual({ evicts: ["installed", "dev"] });
  expect(mocks.occupants).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("dev --open still reuses its same-version service", async () => {
  Object.assign(mocks.ownership, {
    lane: "dev",
    serviceName: "host-source-test",
    sourceRoot: "C:/checkout",
  });
  mocks.discover.mockResolvedValue({ ...incumbent, lane: "dev", version: "dev", port: 6000 });
  process.argv.push("--open");
  await launch();
  expect(mocks.bind).not.toHaveBeenCalled();
  expect(mocks.occupants).not.toHaveBeenCalled();
  expect(windows()).toHaveLength(1);
  expect(windows()[0]![1]).toContain("http://127.0.0.1:6000/");
});
