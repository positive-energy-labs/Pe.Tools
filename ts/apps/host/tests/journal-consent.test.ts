import { bindFixtureCommands, invokeCommand } from "./command-fixture.ts";
import type { CommandResources } from "../src/command-executor.ts";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { bindControl } from "../src/control.ts";
import { RunConsents, type ConsentEvent } from "../src/run-consent.ts";
import type { ActionAdmission, Caller } from "@pe/agent-contracts";

const run = { thread: "thread", turn: "turn" };
const caller: Caller = { kind: "pea", context: "host-minted", thread: run.thread, run, root: run };
const declaredEffects = [{ kind: "file" as const, path: "C:/user/design.json" }];
const admission = (id: string): ActionAdmission => ({
  id,

  key: "test.write",
  target: { kind: "host" },
  input: { value: 250 },
});
const setup = async (probe?: CommandResources["probe"]) => {
  const dir = await mkdtemp(join(tmpdir(), "pe-consent-")),
    path = join(dir, "journal.jsonl");
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, e) => events.push(e));
  runs.open(run);
  bindControl({ runs, acquired: () => null });
  const journal = new ActionJournal(path);
  bindFixtureCommands(journal, probe ? { probe } : {});
  const ready = async () =>
    vi.waitFor(() => expect(events.some((e) => e.kind === "permission_request")).toBe(true));
  const approve = () => {
    const ask = events.find((e) => e.kind === "permission_request");
    if (!ask || ask.kind !== "permission_request") throw Error("No ask");
    runs.decide(run.thread, ask.requestId, "allow_now");
  };
  return {
    dir,
    path,
    events,
    runs,
    journal,
    approve,
    ready,
    close: async () => {
      runs.closeAll();
      await Promise.all((await journal.list()).map((r) => journal.wait(r.id).catch(() => null)));
      await rm(dir, { recursive: true, force: true });
    },
  };
};

test("waiting commands are durable, share approval, freeze submitted bytes and serialize common destinations", async () => {
  const h = await setup();
  try {
    let prepared = 0,
      effects = 0;
    const frozen = { revision: 13, value: 250 };
    const submit = async (id: string) =>
      invokeCommand(
        h.journal,
        { ...admission(id), caller, basis: null, effects: declaredEffects },
        async () => {
          prepared++;
          return { ...frozen };
        },
        async (e) =>
          e.step("file", "write", e.prepared, async () => {
            effects++;
            return effects;
          }),
      );
    const a = await submit("a"),
      b = await submit("b");
    await h.ready();
    expect([a.state, b.state, prepared, effects]).toEqual(["waiting", "waiting", 0, 0]);
    expect(await readFile(h.path, "utf8")).toContain('"state":"waiting"');
    expect(h.events.filter((e) => e.kind === "permission_request")).toHaveLength(1);
    h.approve();
    const settled = await Promise.all([h.journal.wait("a"), h.journal.wait("b")]);
    expect(settled.map((r) => r.state)).toEqual(["succeeded", "succeeded"]);
    expect(settled[0]!.consent).toEqual(settled[1]!.consent);
    expect(effects).toBe(2);
    h.runs.close(run, "completed");
    expect((await submit("a")).state).toBe("succeeded");
    await expect(submit("late")).rejects.toThrow("run.closed");
    await expect(
      invokeCommand(
        h.journal,
        { ...admission("a"), input: { value: 999 }, caller, basis: null, effects: declaredEffects },
        async () => null,
        async () => null,
      ),
    ).rejects.toThrow("conflicts");
    await expect(
      invokeCommand(
        h.journal,
        {
          ...admission("a"),
          caller: { kind: "pea", context: "other", thread: "other" },
          basis: null,
          effects: declaredEffects,
        },
        async () => null,
        async () => null,
      ),
    ).rejects.toThrow("another authenticated");
  } finally {
    await h.close();
  }
});

test("an acquired document supplies provenance without bypassing the run countdown", async () => {
  const h = await setup();
  bindControl({ acquired: () => "pea-acquisition" });
  let writes = 0;
  try {
    const target = { session: "owned-session", openId: "owned-document" };
    const row = await invokeCommand(
      h.journal,
      {
        ...admission("acquired-write"),
        caller,
        target: { kind: "document", ref: target },
        basis: {
          kind: "acquisition",
          id: "pea-acquisition",
          scope: { kind: "document", lifetime: target },
        },
        effects: [{ kind: "document", ref: target }],
      },
      async () => null,
      async (execution) => execution.step("native", "write", {}, async () => ++writes),
    );
    expect(row.state).toBe("waiting");
    await h.ready();
    expect(writes).toBe(0);
    h.approve();
    const done = await h.journal.wait(row.id);
    expect(done.state).toBe("succeeded");
    expect(done.consent).toMatchObject({ run, decision: { by: "human" } });
    expect(writes).toBe(1);
  } finally {
    bindControl({ acquired: () => null });
    await h.close();
  }
});

test("admission detaches nested intent and effects from the submitter", async () => {
  const h = await setup();
  const input = { nested: { value: 250 } },
    submittedEffects = structuredClone(declaredEffects);
  try {
    await invokeCommand(
      h.journal,
      { ...admission("detached"), input, caller, basis: null, effects: submittedEffects },
      async () => null,
      async () => null,
    );
    await h.ready();
    input.nested.value = 999;
    submittedEffects[0]!.path = "C:/other.json";
    const [row] = await h.journal.list(undefined, "detached");
    expect(row).toMatchObject({
      input: { nested: { value: 250 } },
      effects: declaredEffects,
    });
    h.approve();
    expect((await h.journal.wait("detached")).input).toEqual({ nested: { value: 250 } });
  } finally {
    await h.close();
  }
});

test("normal child completion cancels unapproved admitted effects before root approval", async () => {
  const h = await setup();
  const child = { thread: "child-thread", turn: "child-turn" };
  const childCaller: Caller = {
    kind: "pea",
    context: "child",
    thread: child.thread,
    run: child,
    root: run,
  };
  h.runs.open(child, run);
  let writes = 0;
  try {
    await invokeCommand(
      h.journal,
      { ...admission("child-write"), caller: childCaller, basis: null, effects: declaredEffects },
      async () => null,
      async (e) => e.step("file", "write", {}, async () => ++writes),
    );
    await h.ready();
    h.runs.close(child, "completed");
    h.approve();
    expect((await h.journal.wait("child-write")).state).toBe("cancelled");
    expect(writes).toBe(0);
    expect(
      await h.runs.authorize({ caller, run, root: run }, "root-write", declaredEffects),
    ).toMatchObject({ run });
  } finally {
    await h.close();
  }
});

test("per-command cancellation preserves the shared decision; Stop cancels every unstarted mutation", async () => {
  const h = await setup();
  try {
    let effects = 0;
    const submit = (id: string) =>
      invokeCommand(
        h.journal,
        { ...admission(id), caller, basis: null, effects: declaredEffects },
        async () => null,
        async (e) => e.step("file", "write", {}, async () => ++effects),
      );
    await submit("a");
    await submit("b");
    await h.journal.cancel("a");
    await h.ready();
    h.approve();
    expect((await h.journal.wait("a")).state).toBe("cancelled");
    expect((await h.journal.wait("b")).state).toBe("succeeded");
    expect(effects).toBe(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await invokeCommand(
      h.journal,
      {
        ...admission("blocked"),
        key: "test.blocked",
        caller,
        basis: null,
        effects: declaredEffects,
      },
      async () => {
        await gate;
        return null;
      },
      async (e) => e.step("file", "late", {}, async () => ++effects),
    );
    h.runs.close(run, "stopped");
    release();
    expect((await h.journal.wait("blocked")).state).toBe("cancelled");
    expect(effects).toBe(1);
  } finally {
    await h.close();
  }
});

test("restart cancels unapproved rows and conflicting consumed edits fail before a file effect", async () => {
  let effects = 0,
    version = 13;
  const h = await setup(async () => [{ id: `version-${version}`, members: [] }]);
  try {
    await invokeCommand(
      h.journal,
      { ...admission("old"), caller, basis: null, effects: declaredEffects },
      async () => null,
      async () => null,
    );
    await h.ready();
    const recovered = await new ActionJournal(h.path).list(undefined, "old");
    expect(recovered[0]?.state).toBe("cancelled");
    h.runs.close(run, "completed");
    await h.journal.wait("old");
    const next = { thread: "thread", turn: "next" };
    h.runs.open(next);
    const by: Caller = { ...caller, run: next, root: next } as Caller;
    await invokeCommand(
      h.journal,
      {
        ...admission("fresh"),
        key: "test.fresh-write",
        caller: by,
        basis: null,
        effects: declaredEffects,
        consumes: [{ kind: "catalog", probe: {}, expected: [{ id: "version-13", members: [] }] }],
      },
      async () => null,
      async (e) => e.step("file", "write", {}, async () => ++effects),
    );
    await vi.waitFor(() =>
      expect(h.events.filter((e) => e.kind === "permission_request")).toHaveLength(2),
    );
    version = 14;
    const ask = h.events.findLast((e) => e.kind === "permission_request")!;
    if (ask.kind === "permission_request") h.runs.decide(next.thread, ask.requestId, "allow_now");
    expect((await h.journal.wait("fresh")).state).toBe("failed");
    expect(effects).toBe(0);
  } finally {
    await h.close();
  }
});

test("root Stop retains a dispatched child result and fences its next effect", async () => {
  const h = await setup();
  const child = { thread: "child-thread", turn: "child-turn" };
  const childCaller: Caller = {
    kind: "pea",
    context: "child",
    thread: child.thread,
    run: child,
    root: run,
  };
  h.runs.open(child, run);
  const dispatched = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  let nextWrites = 0;
  try {
    await invokeCommand(
      h.journal,
      {
        ...admission("child-dispatched"),
        caller: childCaller,
        basis: null,
        effects: declaredEffects,
      },
      async () => null,
      async (e) => {
        await e.step("native", "first", {}, async (requestId) => {
          await h.journal.markDispatched(requestId);
          dispatched.resolve();
          await finish.promise;
          return { applied: true };
        });
        return e.step("file", "next", {}, async () => ++nextWrites);
      },
    );
    await h.ready();
    h.approve();
    await dispatched.promise;
    h.runs.close(run, "stopped");
    finish.resolve();
    const row = await h.journal.wait("child-dispatched");
    expect(row.state).toBe("cancelled");
    expect(row.steps[0]).toMatchObject({
      state: "succeeded",
      result: { applied: true },
      dispatchedAt: expect.any(String),
    });
    expect(nextWrites).toBe(0);
    expect(row.steps).toHaveLength(2);
    expect(row.steps[1]).toMatchObject({ key: "next", state: "cancelled" });
    expect(row.steps[1]!.dispatchedAt).toBeUndefined();
  } finally {
    finish.resolve();
    await h.close();
  }
});

test("receipt recovery authenticates its original principal and Page bindings grant no host-resource writes", async () => {
  const h = await setup();
  try {
    const by: Caller = { kind: "human", via: "local" };
    await invokeCommand(
      h.journal,
      { ...admission("private"), caller: by, basis: { kind: "human" }, effects: declaredEffects },
      async () => null,
      async () => null,
    );
    await h.journal.wait("private");
    await expect(h.journal.readFor({ kind: "anonymous" }, undefined, "private")).rejects.toThrow(
      "Authenticate",
    );
    await expect(h.journal.readFor(caller, undefined, "private")).rejects.toThrow(
      "another authenticated",
    );
    expect(await h.journal.readFor(by, undefined, "private")).toHaveLength(1);
    const page: Caller = { kind: "page", page: "page:@pages/report" };
    await expect(
      invokeCommand(
        h.journal,
        {
          ...admission("page-file"),
          caller: page,
          basis: null,
          effects: [{ kind: "file", path: "C:/user/file.json" }],
        },
        async () => null,
        async () => null,
      ),
    ).rejects.toThrow("no member, file, publication or session effect capability");
    expect(await h.journal.list(undefined, "page-file")).toEqual([]);
  } finally {
    await h.close();
  }
});

test("compaction and restart never forget a command id or replay its successful effect", async () => {
  const h = await setup();
  try {
    const journal = new ActionJournal(h.path, () => null, 1);
    let effects = 0;
    const submit = (owner: ActionJournal) =>
      invokeCommand(
        owner,
        {
          ...admission("durable"),
          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          effects: declaredEffects,
        },
        async () => null,
        async (e) => e.step("file", "write", {}, async () => ++effects),
      );
    await submit(journal);
    await journal.wait("durable");
    for (let i = 0; i < 8; i++) await journal.recordFact({ kind: "turn", phase: "started" });
    const recovered = new ActionJournal(h.path, () => null, 1);
    expect((await submit(recovered)).state).toBe("succeeded");
    expect(effects).toBe(1);
    expect(await recovered.list(undefined, "durable")).toHaveLength(1);
  } finally {
    await h.close();
  }
});
