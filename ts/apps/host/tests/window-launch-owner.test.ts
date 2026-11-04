import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";

// Cross-seam: the real openWindow must emit the exact argv rows that Pe.Host.Tray's ParseOwner test
// (TrayProfileRootTests.TrayAcceptsEveryOwnerArgvTheHostEmits) parses from the same fixture file.
const fixture = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "../../../packages/host-contracts/tests/runtime-ownership.fixture.json",
    ),
    "utf8",
  ),
) as {
  trayLaunches: {
    name: string;
    owner: { lane: "dev" | "installed"; sourceRoot: string | null; installedRoot: string | null };
    launch: string[];
    argv: string[];
  }[];
};

const { owner, spawn } = vi.hoisted(() => ({
  owner: {
    lane: "dev" as "dev" | "installed",
    sourceRoot: null as string | null,
    installedRoot: null as string | null,
    executablePath: "C:/installed/bin/host/Pe.Host.exe",
  },
  spawn: vi.fn(),
}));
vi.mock("../src/host-ownership.ts", () => ({ hostOwnership: owner }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (...args: unknown[]) => {
    spawn(...args.slice(0, -1));
    (args.at(-1) as (...result: unknown[]) => void)(null, "", "");
  },
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => true,
}));
const { openWindow } = await import("../src/host-lifecycle.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  spawn.mockClear();
});

test.each(fixture.trayLaunches.filter((row) => row.launch[0] === "--launch-window"))(
  "$name: openWindow emits the argv the tray parses",
  async (row) => {
    Object.assign(owner, row.owner);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: row.launch[1]! } }),
        ),
    );
    await openWindow(5180);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[1]).toEqual(row.argv);
  },
);
