import { detachedBridge, settle, testRegistry, journalAt } from "./effect-test.ts";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { type ActionJournal } from "../src/action-journal.ts";
import { bindControl } from "../src/control.ts";
import { createPluginRuntime, type Caller, type PluginHooks } from "@pe/agent-contracts";
import { observePluginOperations } from "../src/plugin-receipts.ts";

const run = { thread: "thread", turn: "turn" };
const caller: Caller = { kind: "pea", context: "host-minted", thread: run.thread, run, root: run };
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { NodeServices } from "@effect/platform-node";
import { bindCommandRuntime } from "../src/command-registry.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { saveMember } from "../src/settings.ts";
import { podMemberSaveRequestSchema } from "@pe/host-contracts/operation-types";

// Only external native facts are absent. The command, preparation, probes and writer are real.
async function files() {
  const dir = await mkdtemp(join(tmpdir(), "pe-save-run-"));
  const podsRoot = join(dir, "Pods");
  await mkdir(join(podsRoot, "design"), { recursive: true });
  await writeFile(join(podsRoot, "design", "pod.json"), JSON.stringify({ id: "design" }));
  for (const file of ["a.txt", "b.txt", "c.txt"])
    await writeFile(join(podsRoot, "design", file), "original");
  const runs = testRegistry();
  runs.open(run);
  bindControl({ runs, acquired: () => null });
  const bridge = detachedBridge();
  const captures = new TakeoffCaptures(join(dir, "captures"), join(dir, "aps.json"), () =>
    new Date().toISOString(),
  );
  const path = join(dir, "journal.jsonl");
  let writes = 0,
    loseResult = false;
  const compose = (owner: ActionJournal) =>
    bindCommandRuntime(owner, bridge, captures, { podsRoot }, (key, input) =>
      Effect.gen(function* () {
        if (key !== "pod.member.save") throw Error(`Unexpected local operation ${key}`);
        writes++;
        const saved = yield* saveMember(Schema.decodeUnknownSync(podMemberSaveRequestSchema)(input), { podsRoot });
        if (loseResult) {
          loseResult = false;
          return yield* Effect.fail(Error("File result lost after commit"));
        }
        return saved;
      }),
    );
  const journal = journalAt(path, Date.now, () => null, 1);
  compose(journal);
  const runtime = createPluginRuntime<string>();
  const observed: PluginHooks["op.after"][] = [];
  await runtime.install({
    id: "committed-results",
    setup(c) {
      c.hook("op.after", (event) => {
        observed.push(event);
      });
    },
  });
  const stop = observePluginOperations(journal, runtime.emit);

  const input = (file = "a.txt", content = "reviewed") => ({
    pod: "design",
    path: file,
    content,
    expectedSha256: createHash("sha256").update("original").digest("hex"),
  });
  const request = (id: string, file = "a.txt") => ({
    id,
    key: "pod.member.save",
    target: { kind: "host" as const },
    input: input(file),
  });
  return {
    dir,
    path,
    journal,
    runs,
    request,
    compose,
    observed,
    writes: () => writes,
    loseResult: () => {
      loseResult = true;
    },
    read: (file = "a.txt") => readFile(join(podsRoot, "design", file), "utf8"),
    edit: (bytes: string) => writeFile(join(podsRoot, "design", "a.txt"), bytes),
    async close() {
      stop();
      await runtime.close();
      runs.closeAll();
      await journal.close();
      await captures.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("Pea's real member saves ask nobody, freeze input and preserve identity through compaction and restart", async () => {
  const f = await files();
  const crossing = { caller, basis: null };
  try {
    const a = f.request("a"),
      b = f.request("b", "b.txt");
    await f.journal.invoke(a, crossing);
    await f.journal.invoke(b, crossing);
    a.input.content = "caller mutation";
    const [done, other] = await Promise.all([f.journal.wait("a"), f.journal.wait("b")]);
    expect([done.state, other.state]).toEqual(["succeeded", "succeeded"]);
    if (done.state !== "succeeded" || other.state !== "succeeded")
      throw Error("Member saves did not commit");
    expect(f.observed.map((event) => event.result)).toEqual(
      expect.arrayContaining([done.result, other.result]),
    );
    expect(f.observed).toHaveLength(2);
    await f.journal.invoke(f.request("a"), crossing);
    expect(f.observed).toHaveLength(2);
    expect(await f.read()).toBe("reviewed");
    expect(await f.read("b.txt")).toBe("reviewed");
    f.loseResult();
    await f.journal.invoke(f.request("uncertain", "c.txt"), {
      caller: { kind: "human", via: "local" },
      basis: null,
    });
    expect((await f.journal.wait("uncertain")).state).toBe("unknown");
    expect(await f.read("c.txt")).toBe("reviewed");
    for (let i = 0; i < 8; i++) await f.journal.recordFact({ kind: "turn", phase: "started" });
    f.runs.closeAll();
    const restarted = journalAt(f.path, Date.now);
    f.compose(restarted);
    expect((await restarted.read({ kinds: ["turn"] })).length).toBeLessThanOrEqual(2);
    expect((await restarted.list()).map((row) => row.id).sort()).toEqual(["a", "b", "uncertain"]);
    expect((await readFile(f.path, "utf8")).trim().split("\n").length).toBeLessThan(30);
    expect((await restarted.invoke(f.request("a"), crossing)).state).toBe("succeeded");
    expect((await restarted.list(undefined, "uncertain"))[0]!.state).toBe("unknown");
    expect(f.writes()).toBe(3);
    await expect(restarted.invoke(a, crossing)).rejects.toThrow("conflicts");
    await expect(restarted.readFor({ kind: "anonymous" }, undefined, "a")).rejects.toThrow(
      "Authenticate",
    );
    await expect(
      restarted.readFor(
        {
          ...caller,
          context: "other",
          thread: "other",
          root: { thread: "other", turn: "foreign" },
        },
        undefined,
        "a",
      ),
    ).rejects.toThrow("another authenticated");
    await restarted.close();
  } finally {
    await f.close();
  }
});

// The run registry is what Stop and `run.closed` need (ADR 0038): a run that is not open admits nothing.
test.each(["stop", "child-completed", "restart"] as const)(
  "a Pea save after %s is refused run.closed and leaves real member bytes unchanged",
  async (mode) => {
    const f = await files();
    const child = { thread: "child", turn: "child-turn" };
    f.runs.open(child, run);
    const author: Caller =
      mode === "child-completed"
        ? { kind: "pea", context: "child", thread: child.thread, run: child, root: run }
        : caller;
    try {
      if (mode === "stop") f.runs.close(run, "stopped");
      if (mode === "child-completed") f.runs.close(child, "completed");
      if (mode === "restart") f.runs.closeAll();
      await expect(
        f.journal.invoke(f.request("late"), { caller: author, basis: null }),
      ).rejects.toThrow(/run\.closed/);
      expect(await f.journal.list(undefined, "late")).toEqual([]);
      expect(f.observed).toEqual([]);
      expect(await f.read()).toBe("original");
      expect(f.writes()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test("a human press and a Pea save both commit directly; a consumed member edit refuses before the writer", async () => {
  const f = await files();
  try {
    await f.journal.invoke(f.request("human", "b.txt"), {
      caller: { kind: "human", via: "local" },
      basis: null,
    });
    expect(await f.journal.wait("human")).toMatchObject({ state: "succeeded" });
    expect(await f.read("b.txt")).toBe("reviewed");
    await f.edit("external edit");
    await f.journal.invoke(f.request("stale"), { caller, basis: null });
    expect(await f.journal.wait("stale")).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { kind: "stale" },
    });
    expect(f.observed.map((event) => event.outcome)).toEqual(["succeeded", "failed"]);
    expect(await f.read()).toBe("external edit");
    expect(f.writes()).toBe(1);
  } finally {
    await f.close();
  }
});
