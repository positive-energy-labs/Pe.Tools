import { afterEach, expect, test, vi } from "vite-plus/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { adapterCli, adapterLaunch } from "../src/harness/adapter.ts";
import { createProviders } from "../src/harness/providers.ts";
import type { ProviderRefusal } from "@pe/agent-contracts";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

test.each(["codex", "claude"] as const)(
  "closing the %s installer automatically re-probes the new executable",
  async (harness) => {
    const env = home();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv(
      "PE_HARNESS_ADAPTER_" + harness.toUpperCase(),
      join(import.meta.dirname, "fake-acp-agent.mjs"),
    );
    vi.stubEnv("FAKE_ACP_AUTH", "none");
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
      output: [],
      pid: 0,
      signal: null,
    });
    let closeConsole!: () => void;
    const providers = createProviders({
      probeOnStart: false,
      shellPath: async () => "C:\\stale",
      openConsole: (_command, _env, opened) => {
        opened();
        return new Promise<{ exitCode: number; commandExitCode: number; logPath: string }>(
          (resolve) => {
            closeConsole = () =>
              resolve({
                exitCode: 0,
                commandExitCode: 0,
                logPath: join(env.LOCALAPPDATA, "console.log"),
              });
          },
        );
      },
    });
    const request = (verb: string) =>
      new Request(`http://host/pe/providers/${harness}/${verb}`, { method: "POST" });
    try {
      expect((await (await providers.fetch(request("probe"))).json()).readiness.step).toBe(
        "installed",
      );
      expect(await (await providers.fetch(request("open-login"))).json()).toEqual({ opened: true });
      file(
        harness === "codex"
          ? join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
          : join(env.USERPROFILE, ".local", "bin", "claude.exe"),
      );
      closeConsole();
      await expect
        .poll(() => providers.readiness().find((provider) => provider.id === harness)?.readiness)
        .toMatchObject({ state: "refused", step: "signed-in" });
    } finally {
      await providers.close();
    }
  },
);

test("a zero-exit installer with no executable remains refused with its console and discovery evidence", async () => {
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  const env = home();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("PE_HARNESS_ADAPTER_CODEX", join(import.meta.dirname, "fake-acp-agent.mjs"));
  vi.stubEnv("FAKE_ACP_AUTH", "none");
  vi.mocked(spawnSync).mockReturnValue({
    status: 1,
    stdout: "",
    stderr: "lookup failed",
    output: [],
    pid: 0,
    signal: null,
  });
  const providers = createProviders({
    probeOnStart: false,
    openConsole: async (_command, _env, opened) => {
      opened();
      return { exitCode: 0, commandExitCode: 0, logPath: join(env.LOCALAPPDATA, "console.log") };
    },
  });
  const request = (verb: string) =>
    new Request(`http://host/pe/providers/codex/${verb}`, { method: "POST" });
  try {
    const first = await (await providers.fetch(request("probe"))).json();
    expect(first.readiness.detail).toMatchObject({
      step: "installed",
      message: expect.any(String),
      resolvedExecutable: null,
    });
    expect(logged.mock.calls.flat().join("\n")).toContain(JSON.stringify(first.readiness.detail));
    expect(first.readiness.detail.lookup).toMatchObject({ status: 1, reason: "lookup failed" });
    expect(first.readiness.detail.candidates).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining("codex.exe"),
        reason: expect.stringMatching(/missing|ENOENT/),
      }),
    );
    await providers.fetch(request("open-login"));
    await expect
      .poll(() => providers.readiness().find((p) => p.id === "codex")?.readiness)
      .toMatchObject({
        state: "refused",
        step: "installed",
        detail: { console: { exitCode: 0, logPath: join(env.LOCALAPPDATA, "console.log") } },
      });
  } finally {
    await providers.close();
  }
});

test.runIf(process.platform === "win32")(
  "a locked executable preserves the real Win32 sharing violation, and a miss preserves code 2 or 3",
  async () => {
    const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const env = home();
    const cli = file(join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
    const script = join(env.USERPROFILE, "lock.ps1");
    writeFileSync(
      script,
      "param($path)\n$f = [IO.File]::Open($path, 'Open', 'Read', 'None'); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $f.Dispose()",
    );
    const lock = spawn("powershell.exe", ["-NoProfile", "-File", script, cli], {
      windowsHide: true,
      stdio: "pipe",
    });
    const exited = new Promise<void>((resolve) => lock.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => {
      lock.stdout!.once("data", () => resolve());
      lock.once("error", reject);
    });
    vi.mocked(spawnSync).mockImplementation((command, args, options) =>
      String(command).endsWith("powershell.exe")
        ? native.spawnSync(command, args!, options as any)
        : { status: 1, stdout: "", stderr: "not found", pid: 0, output: [], signal: null },
    );
    const detail: ProviderRefusal = {
      step: "installed",
      message: "",
      candidates: [],
      resolvedExecutable: null,
      lookup: null,
      console: null,
    };
    try {
      expect(adapterCli("codex", env, detail)).toBe("codex");
      expect(detail.candidates[0]).toMatchObject({ path: cli, win32Error: 32 });
      expect([2, 3]).toContain(detail.candidates[1]!.win32Error);
    } finally {
      lock.stdin!.end("\n");
      await exited;
    }
  },
);
function home() {
  const root = mkdtempSync(join(tmpdir(), "pe-discovery-"));
  roots.push(root);
  return { USERPROFILE: root, LOCALAPPDATA: join(root, "local"), Path: "C:\\stale" };
}

test("a launcher exit 0 cannot mask installer exit 17 even when the next ACP probe is ready", async () => {
  const env = home();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("PE_HARNESS_ADAPTER_CODEX", join(import.meta.dirname, "fake-acp-agent.mjs"));
  vi.stubEnv("FAKE_ACP_AUTH", "none");
  vi.mocked(spawnSync).mockReturnValue({
    status: 1,
    stdout: "",
    stderr: "",
    output: [],
    pid: 0,
    signal: null,
  });
  const cli = join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe");
  const logPath = join(env.LOCALAPPDATA, "console.log");
  vi.stubEnv("PE_TEST_SECRET", "synthetic-console-secret");
  const providers = createProviders({
    probeOnStart: false,
    openConsole: async (_command, _env, opened) => {
      opened();
      file(cli);
      vi.stubEnv("FAKE_ACP_AUTH", "account");
      writeFileSync(
        logPath,
        `${"x".repeat(9000)}\ninstaller failure synthetic-console-secret https://example.invalid?private-query`,
      );
      return { exitCode: 0, commandExitCode: 17, logPath };
    },
  });
  const request = (verb: string) =>
    new Request(`http://host/pe/providers/codex/${verb}`, { method: "POST" });
  try {
    await providers.fetch(request("probe"));
    await providers.fetch(request("open-login"));
    await expect
      .poll(() => providers.readiness().find((p) => p.id === "codex")?.readiness)
      .toMatchObject({
        state: "refused",
        step: "installed",
        message: expect.stringContaining("command exited 17; console exit 0"),
        detail: {
          resolvedExecutable: {
            path: cli,
            realPath: cli,
            size: expect.any(Number),
            modifiedAt: expect.any(String),
          },
          console: { exitCode: 0, commandExitCode: 17 },
        },
      });
    const readiness = providers.readiness().find((p) => p.id === "codex")!.readiness;
    if (readiness.state !== "refused") throw new Error("Expected installation refusal");
    expect(readiness.detail?.console).toHaveProperty(
      "outputTail",
      expect.stringContaining("installer failure [redacted]"),
    );
    const tail = readiness.detail!.console!.outputTail;
    expect(tail.length).toBeLessThanOrEqual(8192);
    expect(tail).not.toContain("synthetic-console-secret");
    expect(tail).not.toContain("private-query");
  } finally {
    await providers.close();
  }
});
function file(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "lookup only, never executed");
  return path;
}

test.each(["codex", "claude"] as const)(
  "%s is discovered after installation without restarting the host",
  (harness) => {
    const env = home();
    const fresh = join(env.USERPROFILE, "new tools");
    let registry = "";
    vi.mocked(spawnSync).mockImplementation((_command, args) => ({
      status: String(_command).endsWith("reg.exe") ? 0 : 1,
      stdout: String(args?.[1]).startsWith("HKCU")
        ? `\r\n    Path    REG_EXPAND_SZ    ${registry}\r\n`
        : "\r\n    Path    REG_SZ    C:\\Windows\\System32\r\n",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    }));
    expect(adapterCli(harness, env)).toBe(harness);
    const cli = file(join(fresh, `${harness}.exe`));
    registry = '"%USERPROFILE%\\new tools"';
    expect(adapterCli(harness, env)).toBe(cli);
    expect(adapterLaunch(harness, env).env).toEqual({
      [harness === "codex" ? "CODEX_PATH" : "CLAUDE_CODE_EXECUTABLE"]: cli,
    });
  },
);

test.each(["codex", "claude"] as const)(
  "%s resolves its official installer location in the supplied home",
  (harness) => {
    const env = home();
    const cli = file(
      harness === "codex"
        ? join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
        : join(env.USERPROFILE, ".local", "bin", "claude.exe"),
    );
    expect(adapterCli(harness, env)).toBe(cli);
  },
);
