import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createProviders } from "../src/harness/providers.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
function home() {
  const root = mkdtempSync(join(tmpdir(), "pe-discovery-"));
  roots.push(root);
  // The product root is redirected so the packaged Codex lookup never sees the machine's install.
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "product"));
  return { USERPROFILE: root, LOCALAPPDATA: join(root, "local"), Path: "C:stale" };
}

test("a launcher exit 0 cannot mask installer exit 17 even when the next ACP probe is ready", async () => {
  const env = home();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("PE_HARNESS_ADAPTER_CODEX", join(import.meta.dirname, "fake-acp-agent.mjs"));
  vi.stubEnv("FAKE_ACP_AUTH", "none");
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
