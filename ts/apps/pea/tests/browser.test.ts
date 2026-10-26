import { afterEach, expect, test, vi } from "vite-plus/test";
import { runPeaMain, getPeaCliCommandNames } from "../src/cli.ts";

const { browser, adopt } = vi.hoisted(() => ({ browser: vi.fn(async () => {}), adopt: vi.fn() }));
vi.mock("@pe/browser/cli", () => ({ runBrowserCli: browser }));
vi.mock("@pe/mcps", () => ({
  adoptTerminalContext: adopt,
  PeaCliCommands: class {
    commands() {
      return {};
    }
  },
  discoverHostBaseUrl: vi.fn(),
  resolveWorkspaceKey: vi.fn(),
  startPeaMcp: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

test("browser delegates the untouched CLI tail before terminal context adoption", async () => {
  const tail = [
    "session",
    "Runtime.evaluate",
    "--target",
    "target",
    "--params-file",
    "C:/a folder/input.json",
  ];
  const args = ["browser", ...tail];
  await runPeaMain(args);
  expect(browser).toHaveBeenCalledExactlyOnceWith(tail, "pea browser");
  expect(args).toEqual(["browser", ...tail]);
  expect(adopt).not.toHaveBeenCalled();
  expect(getPeaCliCommandNames()).toContain("browser");
});
