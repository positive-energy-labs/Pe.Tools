import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { executeSessionCli, runPeRevitCli } from "../src/session-route.ts";
import { peRevitLauncher } from "../src/pe-revit-launch.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: vi.fn(() => ({ cmd: process.execPath, args: [] })),
}));

const envelope = JSON.stringify({
  result: null,
  resolved: {},
  diagnostics: [],
  nextSteps: [],
  guide: "session",
  related: [],
  binary: {},
  command: {},
  exitCode: 3,
});

/** Exercise the production runner against an owned Node child, without an SDK or Revit launch. */
async function fixture<T>(source: string, run: (args: string[], root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "pe-sdk-child-"));
  try {
    const script = join(root, "child.cjs");
    await writeFile(script, source);
    vi.mocked(peRevitLauncher).mockReturnValue({ cmd: process.execPath, args: [] });
    return await run([script], root);
  } finally {
    vi.mocked(peRevitLauncher).mockReset();
    await rm(root, { recursive: true, force: true });
  }
}

test("SDK refusal output survives a real nonzero child exit while stderr drains", async () => {
  await fixture(
    `process.stderr.write('diagnostic'.repeat(100000)); process.stdout.write(${JSON.stringify(envelope)}, () => { process.exitCode = 3; });`,
    async (args) => {
      expect(await Effect.runPromise(runPeRevitCli(args))).toBe(envelope);
    },
  );
});

test("timeout awaits termination of the actual CLI child", async () => {
  await fixture(
    "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'pid'), String(process.pid)); setInterval(() => {}, 1000);",
    async (args, root) => {
      const outcome = await Effect.runPromise(
        executeSessionCli(args, runPeRevitCli, 1000, { action: "list" }),
      );
      expect(outcome.status).toBe(504);
      const pid = Number(await readFile(join(root, "pid"), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );
});
