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
