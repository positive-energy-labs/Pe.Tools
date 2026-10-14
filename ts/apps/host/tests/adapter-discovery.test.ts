import { afterEach, expect, test, vi } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { adapterCli, adapterLaunch } from "../src/harness/adapter.ts";
import { createProviders } from "../src/harness/providers.ts";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
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
        return new Promise<void>((resolve) => {
          closeConsole = resolve;
        });
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
function home() {
  const root = mkdtempSync(join(tmpdir(), "pe-discovery-"));
  roots.push(root);
  return { USERPROFILE: root, LOCALAPPDATA: join(root, "local"), Path: "C:\\stale" };
}
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
