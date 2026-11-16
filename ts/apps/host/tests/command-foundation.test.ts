import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";
import {
  CommandFailure,
  CommandId,
  OwnerOutcome,
  type CommandRef,
  type InvocationRecord,
} from "../../../packages/agent-contracts/src/command-authority.ts";
import {
  commandInvocation,
  type CommandTransport,
  type InvocationSlot,
} from "../../../packages/runtime/src/command-invocation.ts";
import { CommandClosure } from "../src/commands/closure.ts";
import { engineCustody } from "../src/commands/custody.ts";
import { commandFoundationLayer } from "../src/commands/layer.ts";
import { commandLimits, json, type Binding, type CommandLimits } from "../src/commands/model.ts";
import {
  commandProgram,
  NativeCommandOwner,
  OutsideCommandOwner,
  SameDatabaseOperation,
} from "../src/commands/program.ts";
import { applyFamiliesProgram, drawRoomsProgram } from "../src/commands/proving-programs.ts";
import {
  CommandService,
  type CommandAdapter,
  type CommandAuthority,
} from "../src/commands/service.ts";

// effect-edge: test-runner
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const ref = { id: CommandId.make("host-ticket") };
const intent = { key: "test", input: "{}" };
const ticket = { _tag: "InertTicket" as const, ref, authored: intent, intent };
const observed = {
  ref,
  state: "accepted" as const,
  stop: false,
  result: null,
  problem: null,
  ownerSteps: [],
};
const binding: Binding = {
  principal: "person",
  authority: "connection-1",
  target: "exact-process/open",
  parent: null,
  stopWithParent: false,
};
const adapter: CommandAdapter = {
  normalize: (input) => Effect.succeed(json(JSON.parse(input))),
  prepare: () => Effect.succeed({ plan: "{}", claims: ["preview-1"], version: "v1" }),
};
const authority: CommandAuthority = {
  observe: () => Effect.succeed("v1"),
  current: (_b, v) => v === "v1",
};
const directory = () => {
  const root =
    process.env.PE_COMMAND_FOUNDATION_EVIDENCE ??
    fileURLToPath(
      new URL(
        "../../../../.artifacts/runs/converge-20261116-wave0/shared-foundation",
        import.meta.url,
      ),
    );
  mkdirSync(join(root, "cases"), { recursive: true });
  const path = mkdtempSync(join(root, "cases", "case-"));
  appendFileSync(join(root, "cases.jsonl"), `${JSON.stringify({ path })}\n`);
  return path;
};
const failure = () => new CommandFailure({ problem: "invalid", ref: null });
const closureAt = (dir: string) => {
  const file = join(dir, "closure-input.js");
  writeFileSync(file, "actual-code-v1");
  return CommandClosure.seal([file], { frozen: "config-v1" });
};
const requireActivityResult = Effect.fn("test.requireActivityResult")(function* <A>(
  service: CommandService["Service"],
  command: CommandRef,
  occurrence: number,
  schema: Schema.Codec<A>,
) {
  const reply = yield* service.activityResult(command, occurrence, schema);
  if (Option.isNone(reply.result))
    return yield* Effect.die(new Error("Persisted Activity reply missing"));
  return { identity: reply.identity, exit: reply.result.value };
});

describe("inert invocation authority", () => {
  const fixture = () => {
    let record: InvocationRecord | undefined;
    let allocation = 0,
      submits = 0;
    const slot: InvocationSlot = {
      exclusive: (body) => body(),
      read: async () => record,
      write: async (next) => {
        record = structuredClone(next);
      },
    };
    const transport: CommandTransport = {
      allocate: async () => {
        allocation++;
        return ticket;
      },
      submit: async () => {
        submits++;
        return observed;
      },
      read: async () => observed,
    };
    return { slot, transport, record: () => record, counts: () => ({ allocation, submits }) };
  };
  test("F01 lost submit keeps original ref; retry never allocates", async () => {
    const f = fixture();
    f.transport.submit = async () => {
      throw Error("lost reply");
    };
    await expect(commandInvocation(f.slot, f.transport).new(intent)).rejects.toMatchObject({
      problem: "observation-lost",
      ref,
    });
    expect(f.record()).toEqual({ _tag: "SubmissionPending", ticket });
    f.transport.submit = async (original) => {
      expect(original).toEqual(ref);
      return observed;
    };
    await commandInvocation(f.slot, f.transport).retry();
    expect(f.counts().allocation).toBe(1);
    expect(f.record()?._tag).toBe("Accepted");
  });
  test("F01 local retention failure prevents executable submit", async () => {
    const f = fixture();
    f.slot.write = async (record) => {
      if (record._tag === "Allocated") throw Error("disk full");
    };
    await expect(commandInvocation(f.slot, f.transport).new(intent)).rejects.toThrow("disk full");
    expect(f.counts()).toEqual({ allocation: 1, submits: 0 });
  });
  test("F01 absent/corrupt acknowledged slot refuses", async () => {
    const f = fixture();
    await expect(commandInvocation(f.slot, f.transport).retry()).rejects.toThrow("unavailable");
    f.slot.read = async () => ({ _tag: "Accepted" });
    await expect(commandInvocation(f.slot, f.transport).retry()).rejects.toThrow();
    expect(f.counts()).toEqual({ allocation: 0, submits: 0 });
  });
  test.each(["Accepted", "Terminal"] as const)(
    "PUR-C1-03 retained %s refuses a mismatched original-ref join",
    async (tag) => {
      const f = fixture();
      const other = { ...observed, ref: { id: CommandId.make("another-command") } };
      f.slot.read = async () => ({ _tag: tag, ticket, observation: other });
      await expect(commandInvocation(f.slot, f.transport).retry()).rejects.toMatchObject({
        problem: "conflict",
        ref,
      });
      expect(f.counts()).toEqual({ allocation: 0, submits: 0 });
    },
  );
  test("PUR-C1-03 observe and submit both refuse another command's response", async () => {
    const f = fixture();
    const other = { ...observed, ref: { id: CommandId.make("another-command") } };
    f.transport.read = async () => other;
    await expect(commandInvocation(f.slot, f.transport).observe(ref)).rejects.toMatchObject({
      problem: "conflict",
      ref,
    });
    expect(f.counts()).toEqual({ allocation: 0, submits: 0 });
    f.transport.submit = async () => other;
    await expect(commandInvocation(f.slot, f.transport).new(intent)).rejects.toMatchObject({
      problem: "conflict",
      ref,
    });
    expect(f.record()).toEqual({ _tag: "SubmissionPending", ticket });
  });
  test("PUR-C1-01 changed authored correlation and operation key still refuse before submit", async () => {
    for (const changed of [
      { ...ticket, authored: { ...intent, input: '{"changed":true}' } },
      { ...ticket, intent: { ...intent, key: "other-operation" } },
    ]) {
      const f = fixture();
      f.transport.allocate = async () => changed;
      await expect(commandInvocation(f.slot, f.transport).new(intent)).rejects.toMatchObject({
        problem: "conflict",
        ref,
      });
      expect(f.counts().submits).toBe(0);
      expect(f.record()?._tag).toBe("Allocating");
    }
  });
});

test.each([
  { input: '{ "b": 2, "a": 1 }', canonical: '{"a":1,"b":2}', defaults: false },
  { input: "{ }", canonical: '{"mode":"default"}', defaults: true },
])(
  "PUR-C1-01 real helper/service compose across normalization $canonical",
  ({ input, canonical, defaults }) =>
    run(
      Effect.scoped(
        Effect.gen(function* () {
          const dir = directory();
          const closure = yield* closureAt(dir);
          const normalizer: CommandAdapter = {
            ...adapter,
            normalize: (input) =>
              Effect.succeed(
                json(defaults ? { mode: "default", ...JSON.parse(input) } : JSON.parse(input)),
              ),
          };
          const context = yield* Layer.build(
            commandFoundationLayer(
              join(dir, "engine"),
              { closure, authority, adapters: new Map([["test", normalizer]]) },
              () => Effect.succeed("done"),
              "provision",
            ),
          );
          const service = Context.get(context, CommandService);
          let record: InvocationRecord | undefined;
          let allocations = 0,
            submits = 0;
          const helper = commandInvocation(
            {
              exclusive: (body) => body(),
              read: async () => record,
              write: async (value) => {
                record = structuredClone(value);
              },
            },
            {
              allocate: async (authored) => {
                allocations++;
                return run(service.allocate(authored, binding));
              },
              submit: async (ref) => {
                submits++;
                return run(service.submit(ref, binding).pipe(Effect.provideContext(context)));
              },
              read: (ref) => run(service.read(ref, binding)),
            },
          );
          const authored = { key: "test", input };
          const observation = yield* Effect.tryPromise({
            try: () => helper.new(authored),
            catch: (cause) => new CommandFailure({ problem: "invalid", ref: null, cause }),
          });
          expect(record).toMatchObject({
            _tag: "Accepted",
            ticket: { authored, intent: { key: "test", input: canonical }, ref: observation.ref },
          });
          expect(allocations).toBe(1);
          expect(submits).toBe(1);
          const [row] = yield* service.sql<{
            n: number;
          }>`SELECT count(*) AS n FROM command_authority`;
          expect(row.n).toBe(1);
        }),
      ),
    ),
);

describe.each(["native", "outside"] as const)("PUR-C4-02 %s owner-result preservation", (kind) => {
  test.each([
    { outcome: "refused", dispatch: "not-dispatched", value: null, evidence: "departure-refusal" },
    { outcome: "failed", dispatch: "dispatched", value: null, evidence: "dispatched-failure" },
    { outcome: "cancelled", dispatch: "dispatched", value: null, evidence: "owner-cancelled" },
    { outcome: "unknown", dispatch: "unknown", value: null, evidence: "lost-reply" },
  ] as const)("$outcome survives constructor failure and canonical observation", (outcome) =>
    run(
      Effect.scoped(
        Effect.gen(function* () {
          const dir = directory();
          const started = performance.now();
          const mark = (phase: string) =>
            appendFileSync(
              join(dir, "phases.jsonl"),
              `${JSON.stringify({ kind, outcome: outcome.outcome, phase, ms: performance.now() - started })}\n`,
            );
          mark("scope-start");
          yield* Effect.addFinalizer(() => Effect.sync(() => mark("scope-released")));
          const closure = yield* closureAt(dir);
          mark("closure-sealed");
          const settled = yield* Deferred.make<Exit.Exit<string, CommandFailure>>();
          let invoked = 0;
          const completed = {
            outcome: "completed" as const,
            dispatch: "dispatched" as const,
            value: json({ elementId: 42, guid: "00000000-0000-4000-8000-000000000002" }),
            evidence: "completed-prefix",
          };
          const answer = () => Effect.sync(() => (invoked++ === 0 ? completed : outcome));
          const owners = Layer.mergeAll(
            Layer.succeed(NativeCommandOwner, { depart: answer }),
            Layer.succeed(OutsideCommandOwner, { invoke: answer }),
          );
          const context = yield* Layer.build(
            commandFoundationLayer(
              join(dir, "engine"),
              { closure, authority, adapters: new Map([["test", adapter]]) },
              (row) =>
                Effect.gen(function* () {
                  const program = yield* commandProgram(row);
                  for (let i = 0; i < 2; i++) {
                    if (kind === "native")
                      yield* program.native("rooms.draw", { view: "view", loops: [] });
                    else yield* program.outside("shell.open", "{}");
                  }
                  return "must not succeed";
                }).pipe(
                  Effect.onExit((exit) => Deferred.succeed(settled, exit)),
                  Effect.provide(owners),
                ),
              "provision",
            ),
          );
          const service = Context.get(context, CommandService);
          mark("graph-built");
          yield* Effect.gen(function* () {
            const ticket = yield* service.allocate(intent, binding);
            mark("allocated");
            yield* service.submit(ticket.ref, binding);
            mark("accepted");
            const exit = yield* Deferred.await(settled);
            mark("feature-settled");
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("Expected owner failure"));
            const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            const steps = yield* service.sql<{
              occurrence: number;
              request_id: string;
            }>`SELECT occurrence,request_id FROM command_steps WHERE command_id=${ticket.ref.id} ORDER BY occurrence`;
            const expected = {
              _tag: "Recorded",
              occurrence: 1,
              requestId: steps[1].request_id,
              attempt: 1,
              outcome,
            };
            expect(error.ref).toEqual(ticket.ref);
            expect(error.ownerStep).toEqual(expected);
            const observed = yield* service.read(ticket.ref, binding);
            mark("observed");
            expect(observed.ownerSteps).toEqual([
              {
                _tag: "Recorded",
                occurrence: 0,
                requestId: steps[0].request_id,
                attempt: 1,
                outcome: completed,
              },
              expected,
            ]);
            expect((yield* service.submit(ticket.ref, binding)).ownerSteps).toEqual(
              observed.ownerSteps,
            );
            expect(invoked).toBe(2);
            mark("assertions-complete");
          }).pipe(Effect.provideContext(context));
        }),
      ),
    ),
  );
});

test("F03/F04 actual graph atomic acceptance, duplicate joins, claim conflict and inert Stop", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          () => Effect.succeed("done"),
          "provision",
        );
        const context = yield* Layer.build(layer);
        yield* Effect.gen(function* () {
          const service = yield* CommandService;
          const first = yield* service.allocate(intent, binding);
          const observations = yield* Effect.all(
            [service.submit(first.ref, binding), service.submit(first.ref, binding)],
            { concurrency: "unbounded" },
          );
          expect(observations.map((x) => x.ref)).toEqual([first.ref, first.ref]);
          const [count] = yield* service.sql<{
            n: number;
          }>`SELECT count(*) AS n FROM command_claims`;
          expect(count.n).toBe(1);
          const [rows] = yield* service.sql<{
            n: number;
          }>`SELECT count(*) AS n FROM command_authority WHERE admission_order IS NOT NULL`;
          expect(rows.n).toBe(1);
          const messages = yield* service.sql<{
            payload: string;
          }>`SELECT payload FROM cluster_messages WHERE tag='run'`;
          expect(messages).toHaveLength(1);
          expect(messages[0].payload).toContain(first.ref.id);
          const second = yield* service.allocate(intent, binding);
          const conflict = yield* Effect.exit(service.submit(second.ref, binding));
          expect(Exit.isFailure(conflict)).toBe(true);
          const [secondRow] = yield* service.sql<{
            state: string;
          }>`SELECT state FROM command_authority WHERE id=${second.ref.id}`;
          expect(secondRow.state).toBe("allocated");
          yield* service.stop(second.ref, binding);
          expect((yield* service.submit(second.ref, binding)).state).toBe("stopped");
          expect(
            Exit.isFailure(
              yield* Effect.exit(service.submit({ id: CommandId.make("unknown") }, binding)),
            ),
          ).toBe(true);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F05 changed answering bytes refuse allocation before feature decode", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        let decoded = 0;
        const changedAdapter: CommandAdapter = {
          ...adapter,
          normalize: (input) => {
            decoded++;
            return Effect.succeed(input);
          },
        };
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", changedAdapter]]) },
          () => Effect.succeed("done"),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        writeFileSync(join(dir, "closure-input.js"), "same-version-new-bytes");
        const result = yield* Effect.exit(service.allocate(intent, binding));
        expect(Exit.isFailure(result)).toBe(true);
        expect(decoded).toBe(0);
      }),
    ),
  ));

test("F09 OD8 outside wait does not hold writer; Stop commits and prevents next effect", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const started = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const settled = yield* Deferred.make<void>();
        let calls = 0;
        const outside = Layer.succeed(OutsideCommandOwner, {
          invoke: () =>
            Effect.gen(function* () {
              calls++;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(finish);
              return {
                outcome: "completed" as const,
                dispatch: "dispatched" as const,
                value: "receipt",
                evidence: "owner-receipt",
              };
            }),
        });
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          (row) =>
            Effect.gen(function* () {
              const program = yield* commandProgram(row);
              yield* program.outside("shell.open", "{}");
              yield* program.outside("shell.open", "{}");
              return "done";
            }).pipe(
              Effect.onExit(() => Deferred.succeed(settled, undefined)),
              Effect.provide(outside),
            ),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          const allocated = yield* service.allocate(intent, binding);
          yield* service.submit(allocated.ref, binding);
          yield* Deferred.await(started);
          expect((yield* service.stop(allocated.ref, binding)).status).toBe("stop-recorded");
          yield* Deferred.succeed(finish, undefined);
          yield* Deferred.await(settled);
          expect(calls).toBe(1);
          const [row] = yield* service.sql<{ started: number }>`SELECT started FROM command_steps`;
          expect(row.started).toBe(1);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F11/F12 missing fence and competing owner close before schema/engine; restored header refuses", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        expect(Exit.isFailure(yield* Effect.exit(Effect.scoped(engineCustody(dir, "open"))))).toBe(
          true,
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const custody = yield* engineCustody(dir, "provision");
            expect(custody.generation).toBeTruthy();
            expect(
              Exit.isFailure(yield* Effect.exit(Effect.scoped(engineCustody(dir, "open")))),
            ).toBe(true);
            const fence = JSON.parse(readFileSync(join(dir, "fence.json"), "utf8"));
            writeFileSync(
              join(dir, "fence.json"),
              json({ ...fence, generation: "restored-other-generation" }),
            );
          }),
        );
        expect(Exit.isFailure(yield* Effect.exit(Effect.scoped(engineCustody(dir, "open"))))).toBe(
          true,
        );
      }),
    ),
  ));

test("F13 hard lifetime admission budget retains oldest identity and Stop headroom", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const limits: CommandLimits = {
          ...commandLimits,
          tickets: 2,
          accepted: 1,
          active: 1,
          authorityBytes: commandLimits.reservedCommandBytes * 2,
        };
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, limits, adapters: new Map([["test", adapter]]) },
          () => Effect.succeed("done"),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          const first = yield* service.allocate(intent, binding);
          yield* service.submit(first.ref, binding);
          yield* service.allocate(intent, binding);
          expect(Exit.isFailure(yield* Effect.exit(service.allocate(intent, binding)))).toBe(true);
          expect((yield* service.stop(first.ref, binding)).status).toBe("stop-recorded");
          expect((yield* service.read(first.ref, binding)).ref).toEqual(first.ref);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F06 concrete generated-schema programs give repeated carrier and family leaves distinct occurrence keys", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const settled = yield* Deferred.make<void>();
        const keys: string[] = [],
          retired: string[] = [];
        let carrier = 0;
        const owners = Layer.succeed(NativeCommandOwner, {
          depart: (_row, key, operation) =>
            Effect.sync(() => {
              keys.push(key);
              const value =
                operation === "takeoffs.initialize-carrier"
                  ? {
                      status: "ok",
                      remaining: carrier++ === 0 ? ["00000000-0000-4000-8000-000000000001"] : [],
                    }
                  : operation === "rooms.draw"
                    ? { elementId: 42, guid: "00000000-0000-4000-8000-000000000002" }
                    : { receipts: [], diagnostics: [] };
              return {
                outcome: "completed" as const,
                dispatch: "dispatched" as const,
                value: json(value),
                evidence: "fixture-only",
              };
            }),
        });
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          (row) =>
            Effect.gen(function* () {
              const program = yield* commandProgram(row);
              yield* drawRoomsProgram(program, { view: "view", loops: [] });
              const request = {
                specJson: "{}",
                expectedPlanHashes: {},
                familyNames: {},
                source: {
                  root: {
                    path: "family.json",
                    sha256: "hash",
                    bytesBase64: "e30=",
                    origin: "Operation" as const,
                  },
                  dependencies: [],
                },
              };
              yield* applyFamiliesProgram(
                program,
                [
                  { request, consumed: "leaf-a" },
                  { request, consumed: "leaf-b" },
                ],
                {
                  key: "work.retire",
                  input: Schema.Struct({
                    consumed: Schema.String,
                    successful: Schema.Array(Schema.String),
                    converged: Schema.Array(Schema.String),
                  }),
                  result: Schema.String,
                  apply: (key, input) =>
                    Effect.sync(() => {
                      keys.push(key);
                      retired.push(input.consumed);
                      return input.consumed;
                    }),
                },
              );
              return "done";
            }).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause));
                }).pipe(Effect.andThen(Deferred.succeed(settled, undefined))),
              ),
              Effect.provide(owners),
            ),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          const allocated = yield* service.allocate(intent, binding);
          yield* service.submit(allocated.ref, binding);
          yield* Deferred.await(settled);
          expect(carrier).toBe(2);
          expect(keys).toHaveLength(7);
          expect(new Set(keys).size).toBe(7);
          expect(retired).toEqual(["leaf-a", "leaf-b"]);
          const steps = yield* service.sql<{
            occurrence: number;
            request_id: string;
          }>`SELECT occurrence,request_id FROM command_steps ORDER BY occurrence`;
          expect(steps.map((step) => step.occurrence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
          expect(steps.map((step) => step.request_id)).toEqual(keys);
          yield* service.submit(allocated.ref, binding);
          expect(keys).toHaveLength(7);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F09 same-DB typed decode failure rolls back the body while the engine retains its failure", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const settled = yield* Deferred.make<void>();
        const domainResult = Schema.Array(Schema.Struct({ n: Schema.Number }));
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          (row) =>
            Effect.gen(function* () {
              const store = yield* CommandService;
              const program = yield* commandProgram(row);
              yield* program.database(
                SameDatabaseOperation.make(store, {
                  key: "domain-state",
                  input: Schema.String,
                  result: domainResult,
                  // Wrong result is a typed domain decode failure AFTER a real body mutation.
                  statement: (sql) =>
                    sql`INSERT INTO domain_state(n) VALUES(1) RETURNING 'invalid' AS n`,
                }),
                "input",
              );
              return "must not succeed";
            }).pipe(Effect.onExit(() => Deferred.succeed(settled, undefined))),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          yield* service.sql`CREATE TABLE domain_state(n INTEGER NOT NULL)`;
          const allocated = yield* service.allocate(intent, binding);
          yield* service.submit(allocated.ref, binding);
          yield* Deferred.await(settled);
          const rows = yield* service.sql`SELECT n FROM domain_state`;
          expect(rows).toHaveLength(0);
          const claims = yield* service.sql`SELECT claim FROM command_claims`;
          expect(claims).toHaveLength(1);
          const reply = yield* requireActivityResult(service, allocated.ref, 0, domainResult);
          expect(reply.identity.occurrence).toBe(0);
          expect(Exit.isFailure(reply.exit)).toBe(true);
          if (Exit.isSuccess(reply.exit))
            return yield* Effect.die(new Error("Expected retained typed failure"));
          expect(Option.getOrThrow(Cause.findErrorOption(reply.exit.cause))).toMatchObject({
            problem: "invalid",
            ref: allocated.ref,
          });
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F04 a failing acceptance write rolls claims and plan back, then the same ticket can be accepted", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          () => Effect.succeed("done"),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          yield* service.sql`CREATE TRIGGER reject_plan BEFORE INSERT ON command_plans BEGIN SELECT RAISE(ABORT,'injected'); END`;
          const allocated = yield* service.allocate(intent, binding);
          expect(Exit.isFailure(yield* Effect.exit(service.submit(allocated.ref, binding)))).toBe(
            true,
          );
          expect(yield* service.sql`SELECT * FROM command_claims`).toHaveLength(0);
          expect(yield* service.sql`SELECT * FROM command_plans`).toHaveLength(0);
          expect(yield* service.sql`SELECT * FROM cluster_messages WHERE tag='run'`).toHaveLength(
            0,
          );
          expect((yield* service.read(allocated.ref, binding)).state).toBe("allocated");
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                service.submit(allocated.ref, { ...binding, target: "other-open" }),
              ),
            ),
          ).toBe(true);
          yield* service.sql`DROP TRIGGER reject_plan`;
          expect((yield* service.submit(allocated.ref, binding)).ref).toEqual(allocated.ref);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));

test("F07 durable ancestor Stop refuses a grandchild continuation with no cached authorization", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          () => Effect.succeed("done"),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        const parent = yield* service.allocate(intent, binding);
        const child = yield* service.allocate(intent, {
          ...binding,
          parent: parent.ref.id,
          stopWithParent: true,
        });
        const grandchildBinding = { ...binding, parent: child.ref.id, stopWithParent: true };
        const grandchild = yield* service.allocate(intent, grandchildBinding);
        yield* service.stop(parent.ref, binding);
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              service
                .submit(grandchild.ref, grandchildBinding)
                .pipe(Effect.provideContext(context)),
            ),
          ),
        ).toBe(true);
        expect(yield* service.sql`SELECT * FROM cluster_messages WHERE tag='run'`).toHaveLength(0);
      }),
    ),
  ));

test("F14 completion write failure retains the completed owner prefix and claims, without publishing terminal success", () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const dir = directory();
        const closure = yield* closureAt(dir);
        let invoked = 0;
        const owner = Layer.succeed(OutsideCommandOwner, {
          invoke: () =>
            Effect.sync(() => {
              invoked++;
              return {
                outcome: "completed" as const,
                dispatch: "dispatched" as const,
                value: "receipt",
                evidence: "owner-evidence",
              };
            }),
        });
        const layer = commandFoundationLayer(
          join(dir, "engine"),
          { closure, authority, adapters: new Map([["test", adapter]]) },
          (row) =>
            Effect.gen(function* () {
              const program = yield* commandProgram(row);
              yield* program.outside("shell.open", "{}");
              return "done";
            }).pipe(Effect.provide(owner)),
          "provision",
        );
        const context = yield* Layer.build(layer);
        const service = Context.get(context, CommandService);
        yield* Effect.gen(function* () {
          yield* service.sql`CREATE TRIGGER reject_terminal BEFORE UPDATE ON command_authority
      WHEN NEW.state='terminal' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END`;
          const allocated = yield* service.allocate(intent, binding);
          yield* service.submit(allocated.ref, binding);
          let state = "accepted";
          for (let attempts = 0; attempts < 100 && state === "accepted"; attempts++) {
            state = (yield* service.read(allocated.ref, binding)).state;
            yield* Effect.yieldNow;
          }
          expect(state).toBe("blocked");
          expect(invoked).toBe(1);
          expect(yield* service.sql`SELECT * FROM command_claims`).toHaveLength(1);
          expect((yield* service.read(allocated.ref, binding)).result).toBeNull();
          const persisted = yield* requireActivityResult(service, allocated.ref, 0, OwnerOutcome);
          expect(persisted.identity.occurrence).toBe(0);
          expect(persisted.exit).toEqual(
            Exit.succeed({
              outcome: "completed",
              dispatch: "dispatched",
              value: "receipt",
              evidence: "owner-evidence",
            }),
          );
          const row = yield* service.load(allocated.ref);
          const replies = yield* service.sql<{ request_id: string; payload: string }>`
            SELECT CAST(m.request_id AS TEXT) AS request_id,r.payload FROM cluster_messages m
            JOIN cluster_replies r ON r.id=m.last_reply_id
            WHERE m.entity_type=${`Workflow/${row.tag}`} AND m.entity_id=${row.execution} AND m.tag='activity'
              AND json_extract(m.payload,'$.name')='step-0' AND json_extract(m.payload,'$.attempt')=1`;
          expect(replies).toHaveLength(1);
          yield* Effect.gen(function* () {
            yield* service.sql`UPDATE cluster_replies SET payload='{bad-json' WHERE request_id=${replies[0].request_id}`;
            expect(
              Exit.isFailure(
                yield* Effect.exit(requireActivityResult(service, allocated.ref, 0, OwnerOutcome)),
              ),
            ).toBe(true);
            expect(Exit.isFailure(yield* Effect.exit(service.read(allocated.ref, binding)))).toBe(
              true,
            );
          }).pipe(
            Effect.ensuring(
              service.sql`UPDATE cluster_replies SET payload=${replies[0].payload} WHERE request_id=${replies[0].request_id}`.pipe(
                Effect.orDie,
              ),
            ),
          );
          yield* service.sql`CREATE TEMP TABLE held_activity_reply AS SELECT * FROM cluster_replies WHERE request_id=${replies[0].request_id}`;
          yield* Effect.gen(function* () {
            yield* service.sql`DELETE FROM cluster_replies WHERE request_id=${replies[0].request_id}`;
            expect(
              Exit.isFailure(
                yield* Effect.exit(requireActivityResult(service, allocated.ref, 0, OwnerOutcome)),
              ),
            ).toBe(true);
            expect((yield* service.read(allocated.ref, binding)).ownerSteps).toEqual([
              { _tag: "Unresolved", ...persisted.identity, reason: "pending" },
            ]);
          }).pipe(
            Effect.ensuring(
              service.sql`INSERT INTO cluster_replies SELECT * FROM held_activity_reply`.pipe(
                Effect.orDie,
              ),
            ),
          );
          yield* service.sql`DROP TABLE held_activity_reply`;
          yield* service.submit(allocated.ref, binding);
          expect(invoked).toBe(1);
        }).pipe(Effect.provideContext(context));
      }),
    ),
  ));
