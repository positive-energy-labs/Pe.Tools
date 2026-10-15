import { afterEach, expect, test, vi } from "vite-plus/test";
import { execFile } from "node:child_process";
import { captureUserShellPath, mergePath } from "../src/harness/user-shell.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
afterEach(() => vi.clearAllMocks());

test.runIf(process.platform === "win32")(
  "each capture reads registry PATH and all four PowerShell profiles in order",
  async () => {
    const paths = ["C:\\old", "C:\\new;C:\\uv"];
    vi.mocked(execFile).mockImplementation(((...args: any[]) => {
      expect(args[1]).toContain("-NoProfile");
      const script = args[1].at(-1);
      expect(script).toContain("GetEnvironmentVariable('Path','Machine')");
      expect(script).toContain(
        "$PROFILE.AllUsersAllHosts, $PROFILE.AllUsersCurrentHost, $PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost",
      );
      expect(args[2].windowsHide).toBe(true);
      args.at(-1)(null, `profile output\nPE_SHELL_PATH=${paths.shift()}\n`, "");
    }) as typeof execFile);
    expect(await captureUserShellPath()).toBe("C:\\old");
    expect(await captureUserShellPath()).toBe("C:\\new;C:\\uv");
  },
);

test.runIf(process.platform === "win32")(
  "capture failure is visible instead of silently retaining stale PATH",
  async () => {
    vi.mocked(execFile).mockImplementation(((...args: any[]) => {
      args.at(-1)({ killed: true }, "", "private profile error");
    }) as typeof execFile);
    await expect(captureUserShellPath()).rejects.toThrow("10 second timeout");
  },
);

test("fresh shell PATH leads, host-only tool paths remain, duplicates are case insensitive", () => {
  expect(mergePath(" C:\\UV ;C:\\tools", "c:\\uv;C:\\host")).toBe("C:\\UV;C:\\tools;C:\\host");
});
