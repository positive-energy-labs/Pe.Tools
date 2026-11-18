import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { command } from "../src/command-executor.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { freezeScript, scriptMemberFacts } from "../src/operation-script.ts";
import { settle } from "./effect-test.ts";
import { executableActionReceiptSchema } from "@pe/agent-contracts";

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
// The drive5 Pod row (document-profiler, row ea0fab98): 11 members, ~82 KB of base64, run by
// workspace and source path, so the bundle rides `prepared` and the members ride `consumes`.
const podFiles = [
  { path: "pod.json", bytesBase64: Buffer.from('{"schemaVersion":2,"id":"document-profiler"}').toString("base64") },
  ...["PeScripts.csproj", "src/ClosureReceipts.cs", "src/MechanicalPlanCensus.cs", "src/A.cs", "src/B.cs", "src/C.cs",
    "src/D.cs", "src/E.cs", "src/F.cs", "src/G.cs"].map((path) => ({ path, bytesBase64: randomBytes(5_500).toString("base64") })),
];
const diagnostics = Array.from({ length: 60 }, (_, i) => ({ code: `D${i}`, message: "x".repeat(150) }));

async function open(dir: string) {
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  journal.bindCommands({
    // A member reads back as the sha it was admitted with: the Pod did not change.
    probe: async (dependency) => ("expected" in dependency ? dependency.expected : null),
    resolve: () =>
      command(
        { says: "Script", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
        z.unknown(),
        {
          bind: async ({ admission }) => ({
            effects: [],
            consumes: admission.input.workspaceKey
              ? scriptMemberFacts("document-profiler", podFiles, admission.input.sourcePath) : [],
            prepare: async () => ({
              script: { sourceBundle: admission.input.sourceBundle ?? (admission.input.workspaceKey ? { files: podFiles } : null) },
            }),
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

async function measure(kind: "plain" | "pod" | "pod-real", runs: number) {
  const dir = await mkdtemp(join(tmpdir(), "pe-k2-bytes-"));
  const path = join(dir, "partition-operations.json");
  const { journal, close } = await open(dir);
  const sizes: number[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      const input = kind === "pod"
        ? { sourcePath: "src/Run.cs", sourceBundle: bundle() }
        : kind === "pod-real"
          ? { sourcePath: "src/MechanicalPlanCensus.cs", workspaceKey: "document-profiler" }
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
  ["pod-real", 30, 60_000],
] as const)("%s script runs add a bounded number of journal bytes per run", async (kind, runs, perRun) => {
  const m = await measure(kind, runs);
  try {
    const half = m.sizes[runs / 2 - 1]!, last = m.sizes.at(-1)!;
    console.log(`K2 ${kind}: ${JSON.stringify({ first: m.sizes[0], half, last, steady: Math.round((last - half) / (runs / 2)), max: Math.max(...m.sizes) })}`);
    expect(last / runs).toBeLessThan(perRun);
    expect(Math.max(...m.sizes)).toBeLessThan(Math.max(1 << 20, 2 * perRun * runs) + perRun * 2);
    // The bundle's bytes live once, in the action's output store, never in the journal line.
    if (kind !== "plain") {
      const text = await readFile(m.path, "utf8");
      expect(text).not.toContain('"bytesBase64"');
      for (const file of kind === "pod-real" ? podFiles : []) expect(text).not.toContain(file.bytesBase64);
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

// A caller's own `sourceBundle` value is data, never a path: a refused admission with a hash that
// is not one must not discard the journal at the next start.
test.each([
  ["a path for a hash", { sha256: "a/b" }],
  ["a well-formed hash that names no file", { sha256: "0".repeat(64) }],
])("a receipt carrying %s loads, and every earlier row still lists", async (_case, sourceBundle) => {
  const m = await measure("plain", 2);
  try {
    await m.journal
      .invoke({ id: "odd-hash", key: "scripting.execute", target: { kind: "host" }, input: { sourcePath: "src/Run.cs", sourceBundle } }, { caller: human, basis: null })
      .then(() => m.journal.wait("odd-hash"))
      .catch(() => {});
    const before = (await m.journal.list()).map((row) => row.id).sort();
    expect(before).toContain("odd-hash");
    expect((await m.journal.list(undefined, "odd-hash"))[0]).toMatchObject({ state: "failed" });
    await m.close();
    const reopened = await open(m.dir);
    try {
      const rows = await reopened.journal.list();
      expect(rows.map((row) => row.id).sort()).toEqual(before);
      expect(rows.find((row) => row.id === "odd-hash")!.input.sourceBundle).toEqual(sourceBundle);
    } finally {
      await reopened.close();
    }
  } finally {
    await m.close().catch(() => {});
    await rm(m.dir, { recursive: true, force: true });
  }
}, 60_000);

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

test("a journal line from before K2 with inline member bytes loads, and its row re-parses without them", async () => {
  const m = await measure("pod-real", 1);
  try {
    await m.close();
    const member = /("kind":"member","probe":\{[^}]*\},"expected":"[0-9a-f]{64}")/g;
    const old = (await readFile(m.path, "utf8")).replace(member, '$1,"bytesBase64":"QUJD"');
    expect(old).toContain('"bytesBase64":"QUJD"');
    await writeFile(m.path, old);
    const reopened = await open(m.dir);
    try {
      const [row] = await reopened.journal.list();
      expect(row!.consumes.filter((fact) => fact.kind === "member")).toHaveLength(podFiles.length);
      expect(JSON.stringify(row!.consumes)).not.toContain("bytesBase64");
      // The gate's strict live parse (`action-journal.ts` gate) accepts the recovered row.
      expect(executableActionReceiptSchema.safeParse(row).success).toBe(true);
      expect(await run(reopened.journal, "after-old", { scriptContent: "return 1;" })).toMatchObject({ state: "succeeded" });
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(m.dir, { recursive: true, force: true });
  }
}, 60_000);
