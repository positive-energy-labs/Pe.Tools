import { afterEach, expect, test, vi } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { browserWorkerCommand, dispatchBrowserWorker } from "../src/worker.ts";

const { runtime, keeper, guardian } = vi.hoisted(() => ({
  runtime: { sea: false },
  keeper: vi.fn(async () => {}),
  guardian: vi.fn(async () => {}),
}));
vi.mock("node:sea", () => ({ isSea: () => runtime.sea }));
vi.mock("../src/keeper.ts", () => ({ runBrowserKeeper: keeper }));
vi.mock("../src/attached-guardian.ts", () => ({ runAttachedGuardian: guardian }));

afterEach(() => {
  runtime.sea = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("source launches round-trip both worker modes through the sibling Node entry", async () => {
  for (const mode of ["keeper", "attached-guardian"] as const) {
    const launch = browserWorkerCommand(mode, "C:/product home/browser/config.json");
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[0]).toBe(fileURLToPath(new URL("../src/worker-entry.ts", import.meta.url)));
    expect(await dispatchBrowserWorker(launch.args.slice(1))).toBe(true);
  }
  expect(keeper).toHaveBeenCalledExactlyOnceWith("C:/product home/browser/config.json");
  expect(guardian).toHaveBeenCalledExactlyOnceWith("C:/product home/browser/config.json");
});

test("SEA launches re-enter the executable rather than interpreting a source file", async () => {
  runtime.sea = true;
  vi.stubGlobal("process", { ...process, platform: "win32", execPath: "C:/install/pea.exe" });
  for (const mode of ["keeper", "attached-guardian"] as const) {
    const launch = browserWorkerCommand(mode, "C:/product home/browser/config.json");
    expect(launch.command).toBe("C:/install/pea.exe");
    expect(await dispatchBrowserWorker(launch.args)).toBe(true);
  }
  expect(keeper).toHaveBeenCalledExactlyOnceWith("C:/product home/browser/config.json");
  expect(guardian).toHaveBeenCalledExactlyOnceWith("C:/product home/browser/config.json");
});

test("unsupported packaged workers and malformed worker invocations refuse before execution", async () => {
  expect(await dispatchBrowserWorker(["browser", "guide"])).toBe(false);
  const launch = browserWorkerCommand("keeper", "config.json");
  const workerArgs = launch.args.slice(1);
  for (const args of [
    workerArgs.slice(0, 2),
    [...workerArgs, "extra"],
    [workerArgs[0]!, "eval", "x"],
  ])
    await expect(dispatchBrowserWorker(args)).rejects.toMatchObject({ code: "InvalidOptions" });
  runtime.sea = true;
  vi.stubGlobal("process", { ...process, platform: "linux" });
  expect(() => browserWorkerCommand("keeper", "config.json")).toThrow(/require Windows/);
  await expect(dispatchBrowserWorker(workerArgs)).rejects.toMatchObject({
    code: "UnsupportedRuntime",
    outcome: "not-sent",
  });
  expect(keeper).not.toHaveBeenCalled();
  expect(guardian).not.toHaveBeenCalled();
});
