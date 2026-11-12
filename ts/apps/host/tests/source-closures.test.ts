import { expect, test, vi } from "vite-plus/test";

const execFile = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[], done: (error: null) => void) => done(null)),
);
vi.mock("node:child_process", () => ({ execFile }));

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
    "--builtin-closure-only",
  ]);
});

// Guard: the producer is about a minute of route closure builds. With it on the start path a cold
// source host missed the SDK loader's 90 s readiness limit (homes LEDGER, 2026-11-11).
// `node scripts/time-cold-start.ts --max-healthy-ms 60000` is the same claim on the real process.
test("a dev host start with a current route receipt never runs the producer", async () => {
  const receipt = { checkout: "c", sourceHash: "h", projections: {} };
  vi.resetModules();
  vi.doMock("@pe/host-contracts/route-startup", async (original) => ({
    ...(await original<typeof import("@pe/host-contracts/route-startup")>()),
    readRouteStartupReceipt: () => receipt,
  }));
  try {
    const { prepareDevRouteProjection } = await import("../src/source-closures.ts");
    execFile.mockClear();
    expect(await prepareDevRouteProjection()).toBe(receipt);
    expect(execFile).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock("@pe/host-contracts/route-startup");
    vi.resetModules();
  }
});
