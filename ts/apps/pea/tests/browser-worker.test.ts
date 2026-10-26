import { afterEach, expect, test, vi } from "vite-plus/test";

const { dispatch, cli } = vi.hoisted(() => ({
  dispatch: vi.fn(async () => false),
  cli: vi.fn(async () => {}),
}));
vi.mock("@pe/browser/worker", () => ({ dispatchBrowserWorker: dispatch }));
vi.mock("../src/cli.ts", () => ({ runPeaMain: cli }));
afterEach(() => vi.clearAllMocks());

test("the executable worker path never enters the ordinary CLI", async () => {
  dispatch.mockResolvedValueOnce(true);
  vi.resetModules();
  await import("../src/main.ts");
  expect(dispatch).toHaveBeenCalledOnce();
  expect(cli).not.toHaveBeenCalled();
});

test("the ordinary executable path still runs the CLI after worker dispatch declines it", async () => {
  dispatch.mockResolvedValueOnce(false);
  vi.resetModules();
  await import("../src/main.ts");
  expect(cli).toHaveBeenCalledOnce();
});
