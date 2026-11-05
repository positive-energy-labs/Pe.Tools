import { expect, test, vi } from "vite-plus/test";

const sea = vi.hoisted(() => ({ value: true }));
const execFile = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[], done: (error: null) => void) => done(null)),
);
vi.mock("node:sea", () => ({ isSea: () => sea.value }));
vi.mock("node:child_process", () => ({ execFile }));

test("only a source host runs the closure producer; the SEA inlined closures at pack", async () => {
  const { prepareSourceClosures } = await import("../src/source-closures.ts");
  await prepareSourceClosures();
  expect(execFile).not.toHaveBeenCalled();
  sea.value = false;
  await prepareSourceClosures();
  expect(execFile.mock.calls[0]![1]).toEqual([
    expect.stringMatching(/web[\\/]scripts[\\/]route-graphs\.ts$/),
    "--builtin-closure-only",
  ]);
});
