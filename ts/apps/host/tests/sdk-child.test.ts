import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { executeSessionCli, runPeRevitCli } from "../src/session-route.ts";

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
  const original = process.env.PE_REVIT_CMD;
  try {
    const script = join(root, "child.cjs");
    await writeFile(script, source);
    process.env.PE_REVIT_CMD = process.execPath;
    return await run([script], root);
  } finally {
    if (original === undefined) delete process.env.PE_REVIT_CMD;
    else process.env.PE_REVIT_CMD = original;
    await rm(root, { recursive: true, force: true });
  }
}

test("the native spawn and Windows termination adapter both retain hidden windows", async () => {
  const source = await readFile(new URL("../src/session-route.ts", import.meta.url), "utf8");
  expect(source).toMatch(/spawn\(launch\.cmd,[\s\S]*?windowsHide: true/);
  expect(source).toMatch(/execFile\([\s\S]*?"taskkill"[\s\S]*?windowsHide: true/);
  expect(source).toContain("needsCleanup: () => !closed");
});

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

test("the production runner rejects malformed output from a real child", async () => {
  await fixture("process.stdout.write('{}');", async (args) => {
    await expect(Effect.runPromise(runPeRevitCli(args))).rejects.toThrow("non-envelope");
  });
});

test("a missing native executable returns a 500 without an admitted child", async () => {
  await fixture("", async (_args, root) => {
    process.env.PE_REVIT_CMD = join(root, "missing-executable");
    const outcome = await Effect.runPromise(
      executeSessionCli(["session", "list"], runPeRevitCli, 1000, { action: "list" }),
    );
    expect(outcome.status).toBe(500);
    expect(outcome.bodyJson).toContain("ENOENT");
  });
});
