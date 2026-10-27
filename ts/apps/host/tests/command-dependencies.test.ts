import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import {
  bindWork,
  workHandleSchema,
  type Caller,
  type Consumed,
  type Claim,
} from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RunConsents, type ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";
import type { CommandFactory } from "../src/command-executor.ts";
import { fixtureCommand } from "./command-fixture.ts";
import { BridgeError } from "../src/bridge.ts";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { admitCrossing, callerOf, mintPageDoor, live } from "../src/control.ts";

const run = { thread: "dependency-thread", turn: "first" };
const pea: Caller = { kind: "pea", context: "host-issued", thread: run.thread, run, root: run };
const human: Caller = { kind: "human", via: "local" };
const cell = z.object({
  edit: z.object({ value: z.number() }).passthrough().nullable().optional(),
  suggestion: z.object({ value: z.number() }).passthrough().nullable().optional(),
});
const schema = z.object({
  fields: z.record(z.string(), z.union([z.number(), cell])).default({}),
  profile: z.string().default("a"),
  scope: z.string().default("selected"),
});

test("Page gates retain the minted capability and recheck every effected document after suspension", async () => {
  for (const revoke of [false, true]) {
    const h = await setup();
    const a = { session: "page-session", openId: "a" };
    const b = { session: "page-session", openId: "b" };
    let targets = [a, b];
    bindControl({
      acquired: () => null,
      heads: () => ({
        revision: 3,
        targets: targets.map((ref) => ({
          request: { kind: "open", ref },
          admission: { revision: 3, at: "2026-10-27T12:00:00.000Z", via: "local" },
        })),
      }),
    });
    const minted = mintPageDoor(
      "page:@pages/probe",
      { kind: "thread", thread: "page-thread" },
      "/pages/probe/act",
      false,
      null,
    );
    try {
      const identity = callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: minted.token });
      if (!("caller" in identity)) throw Error("Missing minted Page caller");
      const target = { kind: "document", ref: a } as const;
      const basis = admitCrossing(identity.caller, target, "/pages/probe/act");
      let dispatched = 0;
      await h.journal.invoke(
        { id: "page-capability", key: "probe.page", target, input: {} },
        { caller: identity.caller, basis },
        fixtureCommand(
          [
            { kind: "document", ref: a },
            { kind: "document", ref: b },
          ],
          async () => null,
          async (execution) => {
            await execution.step("file", "first", {}, async () => {
              dispatched++;
              if (revoke) targets = [a];
              return "first";
            });
            return execution.step("file", "second", {}, async () => ++dispatched);
          },
        ),
      );
      const settled = await h.journal.wait("page-capability");
      expect(settled.state).toBe(revoke ? "incomplete" : "succeeded");
      expect(dispatched).toBe(revoke ? 1 : 2);
    } finally {
      minted.retire();
      bindControl({ heads: null });
      await h.close();
    }
  }
});

test.each([false, true])(
  "Page dispatch rechecks secondary-resource trust after an async dependency read; revoked=%s",
  async (revoke) => {
    const h = await setup();
    const a = { session: "page-session", openId: "a" };
    const b = { session: "page-session", openId: "b" };
    let targets = [a, b];
    bindControl({
      acquired: () => null,
      heads: () => ({
        revision: 3,
        targets: targets.map((ref) => ({
          request: { kind: "open", ref },
          admission: { revision: 3, at: "2026-10-27T12:00:00.000Z", via: "local" },
        })),
      }),
    });
    let holdReader = false,
      readerWaiting = false,
      dispatched = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.journal.configureCommands(
      {
        work: h.work,
        read: async () => {
          if (holdReader) {
            readerWaiting = true;
            await held;
          }
          return { version: 1 };
        },
      },
      () => {
        throw Error("No resumed probe");
      },
    );
    const minted = mintPageDoor(
      "page:@pages/probe",
      { kind: "thread", thread: "page-thread" },
      "/pages/probe/act",
      false,
      null,
    );
    try {
      const identity = callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: minted.token });
      if (!("caller" in identity)) throw Error("Missing minted Page caller");
      const target = { kind: "document", ref: a } as const;
      const basis = admitCrossing(identity.caller, target, "/pages/probe/act");
      await h.journal.invoke(
        { id: "page-dispatch", key: "probe.page", target, input: {} },
        { caller: identity.caller, basis },
        fixtureCommand(
          [
            { kind: "document", ref: a },
            { kind: "document", ref: b },
          ],
          async () => null,
          async (execution) =>
            execution.step("native", "probe.native", {}, async (requestId) => {
              holdReader = true;
              const refusal = await h.journal.validateDispatch(requestId);
              if (refusal) throw new BridgeError(refusal, 409, { notDispatched: true });
              await h.journal.markDispatched(requestId);
              return ++dispatched;
            }),
          [{ kind: "catalog", snapshot: { version: 1 } }],
        ),
      );
      await vi.waitFor(() => expect(readerWaiting).toBe(true));
      if (revoke) targets = [a];
      expect(live(basis)).toBeNull();
      release();
      const row = await h.journal.wait("page-dispatch");
      expect(dispatched).toBe(revoke ? 0 : 1);
      expect(row.state).toBe(revoke ? "failed" : "succeeded");
      if (revoke) expect(row).toMatchObject({ notDispatched: true });
    } finally {
      release();
      minted.retire();
      bindControl({ heads: null });
      await h.close();
    }
  },
);

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "pe-dependencies-"));
  const store = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: [
      { spec: { route: "probe", title: "Probe", description: "Dependency probe", schema } },
    ],
    store: {
      getState: async ({ targetKey, route }) => store.get(`${route}/${targetKey}`),
      setState: async ({ targetKey, route, value }) => {
        store.set(`${route}/${targetKey}`, value);
      },
    },
  });
  const key = bindWork("probe", null);
  await work.publish(key, "probe", [{ path: ["fields", "consumed"], value: 0 }], 0);
  const events: ConsentEvent[] = [];
  const runs = new RunConsents((_run, event) => events.push(event));
  runs.open(run);
  bindControl({ runs, acquired: () => null });
  const journal = new ActionJournal(join(directory, "journal.jsonl"));
  journal.configureCommands(
    {
      work,
      read: async () => {
        throw Error("Unexpected dependency");
      },
    },
    () => {
      throw Error("No resumed probe");
    },
  );
  const ready = () =>
    vi.waitFor(() =>
      expect(events.some((event) => event.kind === "permission_request")).toBe(true),
    );
  const approve = () => {
    const ask = events.find((event) => event.kind === "permission_request");
    if (ask?.kind !== "permission_request") throw Error("No countdown");
    runs.decide(run.thread, ask.requestId, "allow_now");
  };
  const close = async () => {
    runs.closeAll();
    await Promise.all((await journal.list()).map((row) => journal.wait(row.id)));
    await rm(directory, { recursive: true, force: true });
  };
  return { directory, work, key, events, runs, journal, ready, approve, close };
}

test("rendered revision refuses unseen Work; later gates compare declared cells, profile and scope", async () => {
  for (const changed of ["unrelated", "consumed", "profile", "scope", "before-admission"]) {
    const h = await setup();
    try {
      const initial = await h.work.read(h.key, "probe");
      const handle = { key: h.key, revision: initial!.revision };
      let effects = 0;
      const factory: CommandFactory = (context) => ({
        definition: {
          says: "Save",
          needs: "nothing",
          effect: "command",
          dirties: [],
          input: z.object({ work: workHandleSchema }),
        },
        bind: async () => {
          const original = await context.read.work(handle, "probe");
          return {
            effects: [{ kind: "file", path: "C:/probe/output" }],
            consumes: [
              {
                kind: "work",
                handle,
                paths: [["fields", "consumed"], ["profile"], ["scope"]],
                snapshot: original.doc,
              },
            ],
          };
        },
        prepared: z.null(),
        prepare: async () => null,
        run: (_context, execution) => execution.step("file", "save", {}, async () => ++effects),
      });
      if (changed === "before-admission")
        await h.work.publish(h.key, "probe", [{ path: ["profile"], value: "b" }], handle.revision);
      const admitted = await h.journal.invoke(
        { id: "save", key: "probe.save", target: { kind: "host" }, input: { work: handle } },
        { caller: pea, basis: null },
        factory,
      );
      if (changed === "before-admission") {
        expect(admitted).toMatchObject({
          state: "failed",
          notDispatched: true,
          refusal: { kind: "stale_revision" },
        });
      } else {
        await h.ready();
        await h.work.publish(
          h.key,
          "probe",
          [
            {
              path: changed === "profile" || changed === "scope" ? [changed] : ["fields", changed],
              value: changed === "profile" || changed === "scope" ? "b" : 7,
            },
          ],
          handle.revision,
        );
        h.approve();
        const finished = await h.journal.wait("save");
        expect(finished.state).toBe(changed === "unrelated" ? "succeeded" : "failed");
        if (changed !== "unrelated")
          expect(finished).toMatchObject({ notDispatched: true, refusal: { kind: "stale" } });
        expect((await h.work.read(h.key, "probe"))!.doc).toMatchObject(
          changed === "unrelated" ? { fields: { unrelated: 7 } } : {},
        );
      }
      expect(effects).toBe(changed === "unrelated" ? 1 : 0);
    } finally {
      await h.close();
    }
  }
});

test("exclusive plans and launch selectors reserve atomically; capture reads remain reusable", async () => {
  const h = await setup();
  try {
    await h.journal.invoke(
      { id: "capture", key: "probe.capture", target: { kind: "host" }, input: {} },
      { caller: human, basis: null },
      fixtureCommand(
        [],
        async () => null,
        async () => ({ capture: true }),
      ),
    );
    await h.journal.wait("capture");
    const consumes: Consumed[] = [{ kind: "receipt", id: "capture", key: "probe.capture" }];
    const claim: Claim = { kind: "receipt", id: "single-use-plan" };
    const submit = (id: string, claims: Claim[] = []) =>
      h.journal.invoke(
        { id, key: "probe.write", target: { kind: "host" }, input: {} },
        { caller: pea, basis: null },
        fixtureCommand(
          [{ kind: "file", path: `C:/${id}` }],
          async () => null,
          async () => null,
          consumes,
          claims,
        ),
      );
    expect((await submit("reuse-a")).state).toBe("waiting");
    expect((await submit("reuse-b")).state).toBe("waiting");
    const [first, second] = await Promise.all([
      submit("plan-a", [claim]),
      submit("plan-b", [claim]),
    ]);
    expect(first.state).toBe("waiting");
    expect(second).toMatchObject({ state: "failed", refusal: { kind: "claimed", by: "plan-a" } });
    const launch: Claim = { kind: "session-slot", selector: { year: "2025", id: "one" } };
    expect((await submit("launch-a", [launch])).state).toBe("waiting");
    expect(await submit("launch-b", [launch])).toMatchObject({
      state: "failed",
      refusal: { kind: "claimed", by: "launch-a" },
    });
    await h.ready();
    h.approve();
    expect((await h.journal.wait("reuse-a")).state).toBe("succeeded");
    expect((await h.journal.wait("reuse-b")).state).toBe("succeeded");
  } finally {
    await h.close();
  }
});

test("explicit reconciliation can close known partial effects but never bypass an unknown outcome", async () => {
  for (const known of [true, false]) {
    const h = await setup();
    try {
      await h.journal.invoke(
        { id: "original", key: "test.partial", target: { kind: "host" }, input: {} },
        { caller: human, basis: null },
        fixtureCommand(
          [{ kind: "directory", path: "C:/acquisition" }],
          async () => null,
          async (execution) => {
            await execution.step("file", "copy", {}, async () => "copied");
            return execution.step("native", "start", {}, async (requestId) => {
              await h.journal.markDispatched(requestId);
              throw new BridgeError(
                known ? "Process ended" : "Reply lost",
                503,
                known ? { dispatched: true } : {},
              );
            });
          },
        ),
      );
      expect((await h.journal.wait("original")).state).toBe(known ? "incomplete" : "unknown");
      let removals = 0;
      const claim: Claim = { kind: "reconciliation", id: "original" };
      const cleanup = await h.journal.invoke(
        { id: "cleanup", key: "test.cleanup", target: { kind: "host" }, input: {} },
        { caller: human, basis: null },
        fixtureCommand(
          [{ kind: "file", path: "C:/acquisition/copy.rvt" }],
          async () => null,
          (execution) => execution.step("file", "remove", {}, async () => ++removals),
          [],
          [claim],
        ),
      );
      if (known) {
        expect((await h.journal.wait(cleanup.id)).state).toBe("succeeded");
        await expect(
          h.journal.invoke(
            { id: "original", key: "test.partial", target: { kind: "host" }, input: {} },
            { caller: human, basis: null },
            fixtureCommand(
              [],
              async () => null,
              async () => "must not run",
            ),
            true,
          ),
        ).rejects.toThrow("reserved");
      } else
        expect(cleanup).toMatchObject({
          state: "failed",
          notDispatched: true,
          refusal: { code: "reconciliation.unresolved" },
        });
      expect(removals).toBe(known ? 1 : 0);
    } finally {
      await h.close();
    }
  }
});

test("same id retains exact input and effects and refuses changed intent", async () => {
  const h = await setup();
  try {
    const input = { nested: { value: 1 } };
    const effects = [{ kind: "file" as const, path: "C:/first" }];
    const factory = fixtureCommand(
      effects,
      async () => null,
      async () => null,
    );
    await h.journal.invoke(
      { id: "immutable", key: "probe.write", target: { kind: "host" }, input },
      { caller: pea, basis: null },
      factory,
    );
    await h.ready();
    input.nested.value = 9;
    effects[0]!.path = "C:/changed";
    expect((await h.journal.list(undefined, "immutable"))[0]).toMatchObject({
      input: { nested: { value: 1 } },
      effects: [{ path: "C:/first" }],
    });
    await expect(
      h.journal.invoke(
        { id: "immutable", key: "probe.write", target: { kind: "host" }, input },
        { caller: pea, basis: null },
        factory,
      ),
    ).rejects.toThrow("conflicts");
    h.approve();
    await h.journal.wait("immutable");
    expect(await readFile(join(h.directory, "journal.jsonl"), "utf8")).toContain('"value":1');
  } finally {
    await h.close();
  }
});

test("a logical launch reservation survives physical resolution and releases only on a dispatched stop", async () => {
  const h = await setup();
  const claim: Claim = { kind: "session-slot", selector: { id: "chosen-session" } };
  try {
    const launch = (id: string) =>
      h.journal.invoke(
        { id, key: "probe.launch", target: { kind: "host" }, input: {} },
        { caller: human, basis: null },
        fixtureCommand(
          [{ kind: "session", session: `reserved:${id}` }],
          async () => null,
          async (execution) =>
            execution.step("native", "start", {}, async (requestId) => {
              await h.journal.markDispatched(requestId);
              await execution.effect({ kind: "session", session: "actual-session" });
              return { started: true };
            }),
          [],
          [claim],
        ),
      );
    await launch("first");
    expect((await h.journal.wait("first")).claims).toEqual([claim]);
    expect(await launch("competing")).toMatchObject({
      state: "failed",
      refusal: { kind: "claimed", by: "first" },
    });
    await h.journal.invoke(
      { id: "stop", key: "probe.stop", target: { kind: "host" }, input: {} },
      { caller: human, basis: null },
      fixtureCommand(
        [{ kind: "session", session: "actual-session" }],
        async () => null,
        async (execution) =>
          execution.step(
            "native",
            "stop",
            {},
            async (requestId) => {
              await h.journal.markDispatched(requestId);
              return { stopped: true };
            },
            undefined,
            undefined,
            () => [{ action: "first", claim }],
          ),
      ),
    );
    expect((await h.journal.wait("stop")).steps[0]).toMatchObject({
      state: "succeeded",
      dispatchedAt: expect.any(String),
      releases: [{ action: "first", claim }],
    });
    expect((await h.journal.list(undefined, "first"))[0]!.claims).toEqual([claim]);
    expect((await launch("after-stop")).state).toBe("running");
    expect((await h.journal.wait("after-stop")).state).toBe("succeeded");
  } finally {
    await h.close();
  }
});

test("own trusted Work publication advances only its recorded patches", async () => {
  const h = await setup();
  try {
    const original = (await h.work.read(h.key, "probe"))!;
    const handle = { key: h.key, revision: original.revision };
    const factory: CommandFactory = () => ({
      definition: {
        says: "Apply",
        needs: "nothing",
        effect: "command",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      },
      bind: async () => ({
        effects: [{ kind: "file", path: "C:/result" }],
        consumes: [
          { kind: "work", handle, paths: [["fields", "consumed"]], snapshot: original.doc },
        ],
      }),
      prepared: z.null(),
      prepare: async () => null,
      run: async (_context, execution) => {
        await execution.step("file", "apply", {}, async () => ({ applied: true }));
        await execution.publishWork(h.key, "probe", [{ path: ["fields", "consumed"], value: 9 }]);
        return execution.step("file", "after-retirement", {}, async () => "continued");
      },
    });
    await h.journal.invoke(
      { id: "publication", key: "probe.apply", target: { kind: "host" }, input: {} },
      { caller: human, basis: null },
      factory,
    );
    const result = await h.journal.wait("publication");
    expect(result).toMatchObject({ state: "succeeded", result: "continued" });
    expect(result.consumes[0]).toMatchObject({ snapshot: { fields: { consumed: 0 } } });
    expect((await h.work.read(h.key, "probe"))!.doc).toMatchObject({ fields: { consumed: 9 } });
  } finally {
    await h.close();
  }
});

test("post-dispatch retirement keeps newer edits and permits the remaining bounded command", async () => {
  const h = await setup();
  try {
    const base = (await h.work.read(h.key, "probe"))!;
    await h.work.publish(
      h.key,
      "probe",
      [
        { path: ["fields", "a"], value: { edit: { value: 1 } } },
        { path: ["fields", "b"], value: { edit: { value: 2 } } },
      ],
      base.revision,
    );
    const original = (await h.work.read(h.key, "probe"))!;
    const handle = { key: h.key, revision: original.revision };
    const factory: CommandFactory = () => ({
      definition: {
        says: "Apply",
        needs: "nothing",
        effect: "command",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      },
      bind: async () => ({
        effects: [{ kind: "file", path: "C:/applied" }],
        consumes: [
          {
            kind: "work",
            handle,
            paths: [
              ["fields", "a"],
              ["fields", "b"],
            ],
            snapshot: original.doc,
          },
        ],
      }),
      prepared: z.null(),
      prepare: async () => null,
      run: async (_context, execution) => {
        await execution.step("native", "apply", {}, async (requestId) => {
          await h.journal.markDispatched(requestId);
          await h.work.apply(
            h.key,
            "probe",
            "human",
            [{ path: ["fields", "a", "edit"], value: { value: 9 } }],
            handle.revision,
          );
          return { applied: true };
        });
        const retired = await execution.retireWork(h.key, "probe", [
          ["fields", "a"],
          ["fields", "b"],
        ]);
        await execution.step("file", "bounded-continuation", {}, async () => "finished");
        return retired;
      },
    });
    await h.journal.invoke(
      { id: "retire", key: "probe.retire", target: { kind: "host" }, input: {} },
      { caller: human, basis: null },
      factory,
    );
    expect(await h.journal.wait("retire")).toMatchObject({
      state: "succeeded",
      result: { retired: [["fields", "b"]] },
    });
    expect((await h.work.read(h.key, "probe"))!.doc).toMatchObject({
      fields: { a: { edit: { value: 9 } }, b: { edit: null } },
    });
  } finally {
    await h.close();
  }
});

test("a stale file refuses before effects even if preparation was durable", async () => {
  const h = await setup();
  try {
    const file = join(h.directory, "source.json");
    await writeFile(file, "before");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update("before").digest("hex");
    await h.journal.invoke(
      { id: "file", key: "probe.file", target: { kind: "host" }, input: {} },
      { caller: pea, basis: null },
      fixtureCommand(
        [{ kind: "file", path: "C:/other" }],
        async () => null,
        async () => {
          throw Error("Must not execute");
        },
        [{ kind: "file", path: file, sha256 }],
      ),
    );
    await h.ready();
    await writeFile(file, "after");
    h.approve();
    expect(await h.journal.wait("file")).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { kind: "stale" },
    });
  } finally {
    await h.close();
  }
});
