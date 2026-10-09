import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { startInstalledTray } from "../src/host-program.ts";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("../src/host-ownership.ts", () => ({
  hostOwnership: {
    lane: "installed",
    executablePath: "C:/product/bin/host/Pe.Host.exe",
    serviceName: "host",
  },
  hostCapabilities: { revit: false },
  productRoot: () => "C:/product",
}));

test("tray gets claim identity without the token and disposal waits for child exit", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough() });
  spawn.mockReturnValue(child);
  const started = startInstalledTray({
    serviceFile: { pid: 123, processStartUtc: "2026-10-09T12:00:00.123Z", token: "secret" },
  } as ServiceHostHandle);
  child.emit("spawn");
  const dispose = await started;
  const [exe, args, options] = spawn.mock.calls[0]!;
  expect(exe.replaceAll("\\", "/")).toBe("C:/product/bin/host/tray/Pe.Host.Tray.exe");
  expect(args).toEqual([
    "--parent-pid",
    "123",
    "--parent-start",
    "2026-10-09T12:00:00.123Z",
    "--service-file",
    expect.stringMatching(/state[\\/]service[\\/]host.json$/),
  ]);
  expect(args).not.toContain("secret");
  expect(options).toEqual({ windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  let disposed = false;
  const exiting = dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  expect(child.stdin.writableEnded).toBe(true);
  expect(disposed).toBe(false);
  child.emit("close", 0);
  await exiting;
  expect(disposed).toBe(true);
});
