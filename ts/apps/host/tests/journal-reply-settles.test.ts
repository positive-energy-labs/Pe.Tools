import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  actionStepSchema,
  persistedActionReceiptSchema,
  persistedReceiptSchema,
  type ActionStep,
} from "@pe/agent-contracts";
import { command, refused, type CommandExecutor } from "@pe/host-internal/command-executor";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";
import { fixtureNative } from "./fixture-native.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

// K1b: a reply settles a step forever. Rows are synthetic, shaped like field record 0cde3cc0.
const human = { kind: "human" as const, via: "cli" as const };
const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wrote = { kind: "wrote", transactions: [], added: 0, modified: 1, deleted: 0 };
const step = (over: Record<string, unknown>) => ({
  id: "s1",
  key: "test.write",
  kind: "native",
  input: {},
  transport: "bridge",
  dispatchedAt: "2026-11-17T22:57:00Z",
  ...over,
});
const row = (state: Record<string, unknown>, steps: object[]) => ({
  id: "a1",
  key: "test.write",
  target: { kind: "host" },
  input: {},
  caller: human,
  basis: null,
  prepared: { state: "ready", value: {} },
  recovery: [],
  startedAt: "2026-11-17T22:56:00Z",
  effects: [],
  claims: [],
  ...state,
  steps,
});
const fieldIncomplete = row(
  { state: "incomplete", error: "RuntimeFailed", status: 500, result: null },
  [
    step({
      state: "failed",
      error: "RuntimeFailed",
      status: 500,
      bridgeReply: "touched",
      touched: wrote,
    }),
  ],
);
const lost = (over: Record<string, unknown> = {}) =>
  row({ state: "unknown", error: "lost", status: 503 }, [
    step({ state: "unknown", error: "lost", status: 503, ...over }),
  ]);

/** A journal over one stored row; `dir` reopens an earlier one, which is one host boot. */
async function journalWith(
  value: object,
  answer: (step: ActionStep) => object,
  options: { dir?: string; executor?: CommandExecutor } = {},
) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "pe-reply-settles-")));
  const path = join(dir, "partition-operations.json");
  const parsed = persistedActionReceiptSchema.parse(value);
  if (!options.dir)
    await writeFile(
      path,
      [
        JSON.stringify({ version: 8 }),
        JSON.stringify({ mapping: [JSON.stringify(["action", parsed.id]), uuid(1)] }),
        JSON.stringify({ mapping: [JSON.stringify(["action-request", parsed.id]), uuid(2)] }),
        JSON.stringify({
          receipt: persistedReceiptSchema.parse({
            schema: 1,
            id: uuid(3),
            revision: 1,
            at: parsed.startedAt,
            stamp: null,
            join: { actionId: uuid(1), requestId: uuid(2) },
            body: { kind: "action", value: parsed },
          }),
        }),
      ].join("\n") + "\n",
    );
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  const recover = vi.fn(async (asked: ActionStep) => ({
    step: actionStepSchema.parse(answer(asked)),
    evidence: { sdk: "op result" },
  }));
  const target = vi.fn(async () => {});
  const ran: string[] = [];
  let definitions = 0;
  const definition = {
    says: "Write",
    needs: "nothing",
    effect: "command",
    dirties: [],
    input: z.record(z.string(), z.unknown()),
  } as const;
  journal.bindCommands({
    probe: async () => null,
    target,
    resolve: () =>
      options.executor ?? {
        ...command(definition, z.unknown(), {
          bind: async () => ({ effects: [] }),
          recover,
          run: (_ctx, execution) =>
            execution
              .step("native", "test.write", {}, () => Effect.die("never redispatched"))
              .pipe(
                Effect.andThen(
                  execution.step("publication", "work.retire", {}, () =>
                    Effect.sync(() => (ran.push("work.retire"), { retired: [] })),
                  ),
                ),
                Effect.as(null),
              ),
        }),
        // The first re-entry's definition read commits the row, so admission takes its retry path.
        definition: async () => {
          if (definitions++ === 0) await journal.markDispatched("s1", "bridge");
          return definition;
        },
      },
  });
  return {
    journal,
    recover,
    target,
    ran,
    bytes: async () => {
      await journal.read({});
      return readFile(path, "utf8");
    },
    dir,
    close: () => settle(Scope.close(host, Exit.void)),
    dispose: async () => {
      await settle(Scope.close(host, Exit.void));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const succeeded = (asked: ActionStep) => {
  const intent: Record<string, unknown> = { ...asked };
  delete intent.error;
  delete intent.status;
  return {
    ...intent,
    state: "succeeded",
    result: { ok: true },
    bridgeReply: "touched",
    touched: wrote,
  };
};

test("A: a failed step with a touched reply is never re-asked, by a resend or by recover", async () => {
  const f = await journalWith(fieldIncomplete, succeeded);
  try {
    const before = await f.bytes();
    const resent = await f.journal.invoke(
      { id: "a1", key: "test.write", target: { kind: "host" }, input: {} },
      { caller: human, basis: null, resent: true },
    );
    expect(resent).toMatchObject({
      state: "incomplete",
      steps: [{ state: "failed", bridgeReply: "touched" }],
    });
    const recovered = await f.journal.recover("a1");
    expect(recovered).toMatchObject({
      state: "incomplete",
      steps: [{ state: "failed", bridgeReply: "touched" }],
    });
    expect(f.recover).not.toHaveBeenCalled();
    expect(await f.bytes()).toBe(before);
  } finally {
    await f.dispose();
  }
});

test.each([
  ["no reply", {}],
  ["a missing-touched reply", { bridgeReply: "missing-touched" }],
  ["a touched reply but an unknown state", { bridgeReply: "touched", touched: wrote }],
])(
  "B: a dispatched step with %s is asked exactly once and settles from the answer",
  async (_name, reply) => {
    const f = await journalWith(lost(reply), (asked) => ({
      ...asked,
      state: "failed",
      error: "RuntimeFailed",
      status: 500,
      bridgeReply: "touched",
      touched: wrote,
    }));
    try {
      const recovered = await f.journal.recover("a1");
      expect(f.recover).toHaveBeenCalledTimes(1);
      expect(recovered).toMatchObject({
        state: "incomplete",
        steps: [{ state: "failed", bridgeReply: "touched" }],
      });
      const settledBytes = await f.bytes();
      await f.journal.recover("a1");
      expect(f.recover).toHaveBeenCalledTimes(1);
      expect(await f.bytes()).toBe(settledBytes);
    } finally {
      await f.dispose();
    }
  },
);

test("C: a lost reply observed as succeeded retires its Work in retirement-only mode, retry included", async () => {
  const f = await journalWith(lost(), succeeded);
  try {
    await f.journal.recover("a1");
    const settled = await f.journal.wait("a1");
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "succeeded" });
    expect(settled.steps.map((each) => `${each.key}:${each.state}`)).toEqual([
      "test.write:succeeded",
      "work.retire:succeeded",
    ]);
    expect(f.ran).toEqual(["work.retire"]);
    expect(f.recover).toHaveBeenCalledTimes(1);
    // The retry re-admission stays retirement-only: it never re-checks the live target.
    expect(f.target).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

// The real 0cde3cc0: the op answered ok, so its step succeeded; the script's RuntimeFailed rides in
// the result, and the executor's check made the action incomplete.
const fieldRow = row(
  {
    state: "incomplete",
    error: "Script execution RuntimeFailed",
    status: 422,
    result: null,
    target: { kind: "session", session: "S" },
  },
  [
    step({
      state: "succeeded",
      result: { status: "RuntimeFailed" },
      bridgeReply: "touched",
      touched: wrote,
    }),
  ],
);

test("E: across three boots and a connect the field row gets no SDK read, no executor run and no revision", async () => {
  let f = await journalWith(fieldRow, succeeded);
  const dir = f.dir;
  try {
    const before = await f.bytes();
    for (let boot = 0; boot < 3; boot++) {
      if (boot) {
        await f.close();
        f = await journalWith(fieldRow, succeeded, { dir });
      }
      await f.journal.reconcile();
      expect(f.recover).not.toHaveBeenCalled();
      expect(f.ran).toEqual([]);
      expect(await f.bytes()).toBe(before);
    }
    await f.journal.reconcile("S");
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.ran).toEqual([]);
    expect(await f.bytes()).toBe(before);
  } finally {
    await f.dispose();
  }
});

test("F: a row this boot interrupted, whose steps all succeeded, retires its Work without an SDK read", async () => {
  const interrupted = row({ state: "running" }, [
    step({ state: "succeeded", result: { ok: true }, bridgeReply: "touched", touched: wrote }),
  ]);
  const f = await journalWith(interrupted, succeeded);
  try {
    await f.journal.reconcile();
    const settled = await f.journal.wait("a1");
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "succeeded" });
    expect(f.ran).toEqual(["work.retire"]);
    expect(f.recover).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

test("G: the recovery adapter applies the live script check: an ok op whose script failed is a failed step", async () => {
  const stepId = "33b9743a-f636-4a48-9eae-67737ad0d506";
  const process = {
    pid: 43608,
    processStartUtc: "2026-10-14T04:48:06.2419090Z",
    executable: "C:/Revit.exe",
  };
  const script = row(
    {
      state: "unknown",
      error: "lost",
      status: 503,
      key: "scripting.execute",
      prepared: { state: "ready", value: { kind: "native-leaf", process, sdkSession: null } },
    },
    [
      step({
        id: stepId,
        key: "scripting.execute",
        state: "unknown",
        error: "lost",
        status: 503,
        process,
      }),
    ],
  );
  const reads: string[][] = [];
  const sdk = async (args: readonly string[]) => {
    reads.push([...args]);
    const envelope = JSON.parse(
      await readFile(join(import.meta.dirname, "sdk-envelopes/op-result.ok.json"), "utf8"),
    );
    Object.assign(envelope.result, { requestId: stepId });
    Object.assign(envelope.result.receipt, {
      requestId: stepId,
      key: "scripting.execute",
      pid: process.pid,
      processStartUtc: process.processStartUtc,
    });
    envelope.result.response = { payload: { status: "RuntimeFailed" }, touched: wrote };
    return JSON.stringify(envelope);
  };
  // The real adapter; recovery reaches neither the bridge nor the local gateway.
  const executor = gatewayExecutor(
    "scripting.execute",
    undefined as never,
    undefined as never,
    undefined as never,
    sdk,
  );
  const f = await journalWith(script, succeeded, { executor });
  try {
    const recovered = await f.journal.recover("a1");
    expect(recovered.steps[0], JSON.stringify(recovered.steps[0])).toMatchObject({
      state: "failed",
      status: 422,
      bridgeReply: "touched",
      touched: wrote,
    });
    expect(recovered.state).not.toBe("succeeded");
    expect(reads).toHaveLength(1);
    const settledBytes = await f.bytes();
    await f.journal.reconcile();
    await f.journal.reconcile("S");
    expect(reads).toHaveLength(1);
    expect(await f.bytes()).toBe(settledBytes);
  } finally {
    await f.dispose();
  }
});

test("H: a lost-reply script answered at boot with no attachment waits, and the connect finishes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-reply-boot-"));
  const recordings = ["retained-script-Succeeded", "retained-host-ops-catalog"] as const;
  const before = await fixtureNative(dir, ...recordings);
  const socket = await before.connect();
  before.loseNextReply("scripting.execute");
  const response = await before.actions()({
    id: "script",
    key: "scripting.execute",
    target: { kind: "document", ref: socket.target },
    input: { scriptContent: "WriteLine(1);" },
  });
  expect(response.status, await response.clone().text()).toBeLessThan(400);
  expect(await before.journal.wait("script")).toMatchObject({ state: "unknown" });
  await before.close();
  // The host restarts; Revit lived and the script finished ok. The SDK answers with no bridge.
  const reads: string[] = [];
  const sdk = async (args: readonly string[]) => {
    if (args[0] !== "op" || args[1] !== "result") return sdkSessions(args);
    reads.push(args[2]!);
    const step = (await after.journal.list(undefined, "script"))[0]!.steps.at(-1)!;
    const envelope = JSON.parse(
      await readFile(join(import.meta.dirname, "sdk-envelopes/op-result.ok.json"), "utf8"),
    );
    Object.assign(envelope.result, { requestId: step.id });
    Object.assign(envelope.result.receipt, {
      requestId: step.id,
      key: "scripting.execute",
      pid: step.process!.pid,
      processStartUtc: step.process!.processStartUtc,
    });
    envelope.result.response = { payload: { status: "Succeeded", output: "1" }, touched: wrote };
    return JSON.stringify(envelope);
  };
  const failed = vi.spyOn(console, "error").mockImplementation(() => {});
  const after = await fixtureNative(dir, ...recordings);
  try {
    after.actions({ sdk });
    // Boot answers the step, then its re-entry is refused for want of the attachment.
    await vi.waitFor(
      () =>
        expect(
          failed.mock.calls.some(([message]) =>
            String(message).includes("reconcile script failed"),
          ),
        ).toBe(true),
      { timeout: 10_000 },
    );
    const pending = (await after.journal.list(undefined, "script"))[0]!;
    // Every step answered: incomplete, never a false "succeeded" (b3b3c878); the connect upgrades it.
    expect(pending.state).toBe("incomplete");
    expect(pending.steps.at(-1)).toMatchObject({ state: "succeeded", bridgeReply: "touched" });
    await after.connect();
    await vi.waitFor(
      async () =>
        expect((await after.journal.list(undefined, "script"))[0]).toMatchObject({
          state: "succeeded",
        }),
      { timeout: 10_000 },
    );
    expect(reads).toHaveLength(1);
    expect(after.calls.filter((call) => call.key === "scripting.execute")).toEqual([]);
  } finally {
    failed.mockRestore();
    await after.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const answeredEveryStep =
  "Revit answered every step in that session, and each step's report says what it did there; the host restarted before this action's follow-up (such as retiring its Work) ran, and nothing here says whether that session's changes were saved";
test("I: a step answered at boot whose session never returns settles incomplete, once, without a re-run", async () => {
  // b3b3c878: the boot read answered "wrote", the session then ended, so the re-entry cannot run.
  const reads = vi.fn(async (asked: ActionStep) => ({
    step: actionStepSchema.parse(succeeded(asked)),
    evidence: {},
  }));
  const executor: CommandExecutor = {
    ...command(
      {
        says: "Write",
        needs: "nothing",
        effect: "command",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      },
      z.unknown(),
      {
        bind: async () => ({ effects: [] }),
        recover: reads,
        run: () => Effect.die("never re-run"),
      },
    ),
    definition: async () => {
      throw refused("The exact bridge attachment is no longer available");
    },
  };
  const lostRow = row(
    {
      state: "unknown",
      error: "Host restarted",
      status: 503,
      target: { kind: "session", session: "S" },
    },
    [step({ state: "unknown", error: "lost", status: 503 })],
  );
  const failed = vi.spyOn(console, "error").mockImplementation(() => {});
  let f = await journalWith(lostRow, succeeded, { executor });
  const dir = f.dir;
  try {
    await f.journal.reconcile();
    const settled = (await f.journal.list(undefined, "a1"))[0]!;
    expect(settled, JSON.stringify(settled)).toMatchObject({
      state: "incomplete",
      steps: [{ state: "succeeded", touched: wrote }],
    });
    // Drive 4, defect 1: `wrote` is true of that Revit session, not of the file on disk.
    expect("error" in settled ? settled.error : "").toBe(answeredEveryStep);
    expect(reads).toHaveBeenCalledTimes(1);
    const once = await f.bytes();
    await f.close();
    f = await journalWith(lostRow, succeeded, { dir, executor });
    await f.journal.reconcile();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(await f.bytes()).toBe(once);
  } finally {
    failed.mockRestore();
    await f.dispose();
  }
});

test("K: a row the live path left unknown for unproven native reads keeps unknown across a boot", async () => {
  const unproven = row(
    {
      state: "unknown",
      error: "Required native reads have no terminal evidence",
      status: 503,
      target: { kind: "session", session: "S" },
    },
    [step({ state: "succeeded", result: { ok: true }, bridgeReply: "touched", touched: wrote })],
  );
  const f = await journalWith(unproven, succeeded);
  try {
    const before = await f.bytes();
    await f.journal.reconcile();
    await f.journal.reconcile("S");
    expect((await f.journal.list(undefined, "a1"))[0]).toMatchObject({
      state: "unknown",
      error: "Required native reads have no terminal evidence",
    });
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.ran).toEqual([]);
    expect(await f.bytes()).toBe(before);
  } finally {
    await f.dispose();
  }
});

test("J: two concurrent recovers of one row make one SDK read", async () => {
  const f = await journalWith(lost(), (asked) => ({
    ...asked,
    state: "failed",
    error: "RuntimeFailed",
    status: 500,
    bridgeReply: "touched",
    touched: wrote,
  }));
  try {
    await Promise.all([f.journal.recover("a1"), f.journal.recover("a1")]);
    expect(f.recover).toHaveBeenCalledTimes(1);
  } finally {
    await f.dispose();
  }
});

test("D: the person- and agent-facing Recover and Resume doors are not routed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-reply-doors-"));
  const native = await fixtureNative(join(dir, "native"));
  try {
    const post = native.actions();
    for (const door of ["/actions/recover", "/actions/resume"]) {
      const response = await post.request(
        new Request(`http://host${door}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "any" }),
        }),
      );
      expect(response.status, `${door}: ${await response.clone().text()}`).toBe(404);
    }
  } finally {
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
});
