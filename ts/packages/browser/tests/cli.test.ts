import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { runBrowserCli } from "../src/cli-runner.ts";

const { connect, launch, send, release, disconnect, page } = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  send: vi.fn(async () => ({ result: { value: "actual result" } })),
  release: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  page: vi.fn(),
}));
vi.mock("../src/browser.ts", () => ({
  connectBrowser: connect,
  openBrowser: launch,
  attachBrowser: vi.fn(),
  listBrowsers: vi.fn(async () => []),
}));

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("raw CDP args and a Windows UTF-8 BOM parameter file survive delegation and cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-cli-"));
  const paramsFile = join(directory, "folder with spaces", "params.json");
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  connect.mockResolvedValue({ page, disconnect });
  page.mockResolvedValue({ sendRaw: send, release });
  try {
    await mkdir(join(directory, "folder with spaces"));
    await writeFile(
      paramsFile,
      "\uFEFF" + JSON.stringify({ expression: '"quoted $value"', returnByValue: true }),
    );
    const argv = [
      "session-id",
      "Runtime.evaluate",
      "--target",
      "target-id",
      "--params-file",
      paramsFile,
      "--home",
      directory,
      "--client-id",
      "agent-id",
      "--timeout-ms",
      "1234",
    ];
    const original = [...argv];
    await runBrowserCli(argv, "pea browser");
    expect(argv).toEqual(original);
    expect(connect).toHaveBeenCalledExactlyOnceWith("session-id", {
      home: directory,
      clientId: "agent-id",
    });
    expect(page).toHaveBeenCalledExactlyOnceWith({ targetId: "target-id", url: undefined });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      "Runtime.evaluate",
      {
        expression: '"quoted $value"',
        returnByValue: true,
      },
      { timeoutMs: 1234 },
    );
    expect(JSON.parse(stdout)).toEqual({ result: { value: "actual result" } });
    expect(release).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("raw calls preserve JSON errors and disconnect when page selection is missing", async () => {
  let stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  connect.mockResolvedValue({ page, disconnect });
  await runBrowserCli(["session-id", "Runtime.evaluate"]);
  expect(JSON.parse(stderr)).toMatchObject({
    error: { code: "CliError", message: expect.stringMatching(/explicit --target/) },
  });
  expect(process.exitCode).toBe(1);
  expect(send).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledOnce();
});

test("guide is plain Markdown from the shared source and never connects to a browser", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  await runBrowserCli(["guide"], "pea browser");
  expect(stdout).toMatch(/^---\r?\nname: use-browser/);
  expect(stdout).toContain("pea browser");
  expect(connect).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});
