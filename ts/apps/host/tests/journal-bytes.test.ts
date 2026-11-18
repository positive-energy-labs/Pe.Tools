import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { copyFile, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { command } from "../src/command-executor.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { freezeScript } from "../src/operation-script.ts";
import { settle } from "./effect-test.ts";

// A compaction that dies before its rename: the journal's own write throws, as a crash would.
const crash = vi.hoisted(() => ({ compaction: false, hit: 0 }));
vi.mock("@pe/host-contracts/kinds", async (original) => {
  const kinds = await original<typeof import("@pe/host-contracts/kinds")>();
  return {
    ...kinds,
    writeState: (file: { path: string }, bytes: string) => {
      if (crash.compaction && file.path.endsWith("partition-operations.json")) {
        crash.hit++;
        throw Error("crash before rename");
      }
      return kinds.writeState(file as never, bytes);
    },
  };
});

// K2: journal bytes per run. Shapes follow the drive's script rows (drive2 journal-final) and the
// field's Pod rows (maddo-20261117 issue 2): the bundle rides input, prepared and the step input.
const human = { kind: "human", via: "local" } as const;
const bundle = () => ({
  files: [
    { path: "pod.json", bytesBase64: Buffer.from('{"id":"pod-k2"}').toString("base64") },
    { path: "src/Run.cs", bytesBase64: randomBytes(173_000).toString("base64") }, // ~231 KB
  ],
});
const diagnostics = Array.from({ length: 60 }, (_, i) => ({ code: `D${i}`, message: "x".repeat(150) }));

async function open(dir: string) {
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  journal.bindCommands({
    probe: async () => null,
    resolve: () =>
      command(
        { says: "Script", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
        z.unknown(),
        {
          bind: async ({ admission }) => ({
            effects: [],
            prepare: async () => ({ script: { sourceBundle: admission.input.sourceBundle ?? null } }),
          }),
          run: ({ admission }, execution) =>
            execution.step("native", "scripting.execute", admission.input, (id) =>
              Effect.promise(async () => {
                await markDispatched(id, "bridge");
                return { diagnostics };
              }),
            ),
        },
      ),
  });
  return { journal, close: () => settle(Scope.close(host, Exit.void)) };
}

const run = async (journal: ActionJournalService["Service"], id: string, input: Record<string, unknown>) => {
  await journal.invoke({ id, key: "script", target: { kind: "host" }, input }, { caller: human, basis: null });
  return journal.wait(id);
};

async function measure(kind: "plain" | "pod", runs: number) {
  const dir = await mkdtemp(join(tmpdir(), "pe-k2-bytes-"));
  const path = join(dir, "partition-operations.json");
  const { journal, close } = await open(dir);
  const sizes: number[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      const input = kind === "pod"
        ? { sourcePath: "src/Run.cs", sourceBundle: bundle() }
        : { scriptContent: "var n = 1;\n".repeat(600) };
      expect(await run(journal, `${kind}-${i}`, input)).toMatchObject({ state: "succeeded" });
      sizes.push((await stat(path)).size);
    }
    return { dir, path, sizes, journal, close };
  } catch (error) {
    await close();
    throw error;
  }
}

test.each([
  // Bound: the file never exceeds max(1 MiB, twice its last compacted size) plus one commit, and a
  // run's latest revision is the only part of it the file keeps after a compaction.
  ["plain", 60, 80_000],
  ["pod", 30, 200_000],
] as const)("%s script runs add a bounded number of journal bytes per run", async (kind, runs, perRun) => {
  const m = await measure(kind, runs);
  try {
    const half = m.sizes[runs / 2 - 1]!, last = m.sizes.at(-1)!;
    console.log(`K2 ${kind}: ${JSON.stringify({ first: m.sizes[0], half, last, steady: Math.round((last - half) / (runs / 2)), max: Math.max(...m.sizes) })}`);
    expect(last / runs).toBeLessThan(perRun);
    expect(Math.max(...m.sizes)).toBeLessThan(Math.max(1 << 20, 2 * perRun * runs) + perRun * 2);
    // The bundle's bytes live once, in the action's output store, never in the journal line.
    if (kind === "pod") {
      expect(await readFile(m.path, "utf8")).not.toContain('"bytesBase64"');
      // The output store holds them once per action, and the step file carries no stale state.
      const home = join(m.dir, "action-outputs");
      const one = join(home, (await readdir(home))[0]!);
      expect((await readdir(join(one, "bundles"))).length).toBe(1);
      const stepFile = join(one, "steps", (await readdir(join(one, "steps")))[0]!);
      expect(JSON.parse(await readFile(stepFile, "utf8"))).not.toHaveProperty("state");
    }
    // A reload resolves every bundle: readers of the latest revision see the bytes, unchanged.
    await m.close();
    const reopened = await open(m.dir);
    try {
      const rows = await reopened.journal.list();
      expect(rows).toHaveLength(runs);
      if (kind === "pod")
        for (const row of rows) {
          expect((row.input.sourceBundle as { files: unknown[] }).files).toHaveLength(2);
          expect((row.prepared as { value: { script: { sourceBundle: { files: unknown[] } } } }).value.script.sourceBundle.files).toHaveLength(2);
          expect((row.steps[0]!.input as { sourceBundle: { files: unknown[] } }).sourceBundle.files).toHaveLength(2);
        }
    } finally {
      await reopened.close();
    }
  } finally {
    await m.close().catch(() => {});
    await rm(m.dir, { recursive: true, force: true });
  }
}, 240_000);

test("a receipt whose bundle bytes are gone loads, and keeps only the hash for the reader to refuse", async () => {
  const m = await measure("pod", 1);
  try {
    await m.close();
    const home = join(m.dir, "action-outputs");
    const one = join(home, (await readdir(home))[0]!);
    await rm(join(one, "bundles"), { recursive: true, force: true });
    const reopened = await open(m.dir);
    try {
      const [row] = await reopened.journal.list();
      expect(row!.input.sourceBundle).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      // The script door seals this input before it runs: a bare hash refuses there, and never
      // falls back to the Pod folder.
      await expect(freezeScript(row!.input)).rejects.toThrow("Invalid Pod source bundle file count");
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(m.dir, { recursive: true, force: true });
  }
}, 60_000);

test("a journal written with bundles inline loads unchanged, with no migration", async () => {
  const m = await measure("pod", 1);
  try {
    await m.close();
    const home = join(m.dir, "action-outputs");
    const one = join(home, (await readdir(home))[0]!);
    // Rebuild the old shape: every hash in the file replaced by the bundle it names.
    const name = (await readdir(join(one, "bundles")))[0]!;
    const sha = name.replace(/\.json$/, "");
    const bytes = JSON.parse(await readFile(join(one, "bundles", name), "utf8"));
    const old = (await readFile(m.path, "utf8")).replaceAll(JSON.stringify({ sha256: sha }), JSON.stringify(bytes));
    await rm(join(one, "bundles"), { recursive: true, force: true });
    await writeFile(m.path, old);
    expect(old).toContain('"bytesBase64"');
    const reopened = await open(m.dir);
    try {
      const [row] = await reopened.journal.list();
      expect(row!.input.sourceBundle).toEqual(bytes);
      // Old rows stay as written until a compaction seals them.
      expect(await readFile(m.path, "utf8")).toBe(old);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(m.dir, { recursive: true, force: true });
  }
}, 60_000);

// The drive's real journal (round 2, kernel run): a copy loads, and its first commit compacts it.
const drive = "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/converge-20261118-kernel/drive2/journal-final.partition-operations.json";
test.skipIf(!existsSync(drive))("the drive's real journal loads and compacts to its live rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-k2-drive-"));
  try {
    const path = join(dir, "partition-operations.json");
    await copyFile(drive, path);
    const before = (await stat(path)).size;
    const { journal, close } = await open(dir);
    try {
      const rows = await journal.list();
      expect(rows.length).toBeGreaterThan(0);
      await run(journal, "after-drive", { scriptContent: "return 1;" });
      const after = (await stat(path)).size;
      console.log(`K2 drive journal: ${JSON.stringify({ before, after, rows: rows.length })}`);
      expect(after).toBeLessThan(before);
    } finally {
      await close();
    }
    const reopened = await open(dir);
    try {
      expect((await reopened.journal.list()).length).toBeGreaterThan(0);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

test("a byte-triggered compaction that dies leaves the appended journal, every row's latest revision readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-k2-crash-"));
  const path = join(dir, "partition-operations.json");
  const { journal, close } = await open(dir);
  crash.compaction = true;
  crash.hit = 0;
  try {
    // Plain runs pass the 1 MiB floor at about the seventh run.
    for (let i = 0; crash.hit === 0 && i < 60; i++)
      await run(journal, `crash-${i}`, { scriptContent: "var n = 1;\n".repeat(600) }).catch(() => {});
    expect(crash.hit).toBeGreaterThan(0);
  } finally {
    crash.compaction = false;
    await close();
  }
  try {
    expect((await stat(path)).size).toBeGreaterThan(1 << 20);
    const reopened = await open(dir);
    try {
      const rows = await reopened.journal.list();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.state).not.toBe("running");
      // The next commit compacts for real, and keeps every row.
      await run(reopened.journal, "after-crash", { scriptContent: "return 1;" });
      expect((await stat(path)).size).toBeLessThan(1 << 20);
      expect(await reopened.journal.list()).toHaveLength(rows.length + 1);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
