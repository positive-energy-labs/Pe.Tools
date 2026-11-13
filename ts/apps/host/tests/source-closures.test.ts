import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFile = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[], _options: unknown, done: (error: null, result: { stdout: string }) => void) => done(null, { stdout: "{}" })),
);
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()), execFile,
}));
vi.mock("@pe/host-contracts/route-startup", async (original) => ({
  ...(await original<typeof import("@pe/host-contracts/route-startup")>()),
  readRouteStartupReceipt: () => undefined,
}));

test("only a source host runs the closure producer; packed Node and SEA inline closures", async () => {
  const { prepareSourceClosures } = await import("../src/source-closures.ts");
  vi.stubGlobal("__PE_SOURCE_COMMIT__", "packed-commit");
  try {
    await prepareSourceClosures();
    expect(execFile).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
  await prepareSourceClosures();
  expect(execFile.mock.calls[0]![1]).toEqual([
    expect.stringMatching(/web[\\/]scripts[\\/]route-graphs\.ts$/),
    "--runtime",
  ]);
});

// Guard: the producer is about a minute of route closure builds. With it on the start path a cold
// source host missed the SDK loader's 90 s readiness limit (homes LEDGER, 2026-11-11).
// `node scripts/time-cold-start.ts --max-healthy-ms 60000` is the same claim on the real process.
test.each(["prepareDevRouteProjection", "prepareSourceClosures"] as const)("%s publishes cached closures without a producer or unchanged rewrites", async (entry) => {
  const root = await mkdtemp(join(tmpdir(), "source-closure-"));
  const path = join(root, "route", "source-closure.generated.json");
  const receipt = { checkout: "c", sourceHash: "h", projections: { [path]: "cached closure\n" } };
  vi.resetModules();
  vi.doMock("@pe/host-contracts/route-startup", async (original) => ({
    ...(await original<typeof import("@pe/host-contracts/route-startup")>()),
    readRouteStartupReceipt: () => receipt,
  }));
  try {
    const bootstrap = await import("../src/source-closures.ts");
    execFile.mockClear();
    const result = await bootstrap[entry]();
    if (entry === "prepareDevRouteProjection") expect(result).toBe(receipt);
    expect(await readFile(path, "utf8")).toBe("cached closure\n");
    const before = (await stat(path)).mtimeMs;
    await Promise.all([bootstrap[entry](), bootstrap[entry]()]);
    expect((await stat(path)).mtimeMs).toBe(before);
    expect(await readdir(join(root, "route"))).toEqual(["source-closure.generated.json"]);
    expect(execFile).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
    vi.doUnmock("@pe/host-contracts/route-startup");
    vi.resetModules();
  }
});
