import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { historyPointSchema } from "@pe/agent-contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { History } from "../src/reads/history.ts";
import { nativeRead } from "../src/reads/inputs.ts";
import { registeredReads } from "../src/reads/routes.ts";
import { familiesViewArgs } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { Publications, read, leaf, RefusedPartition } from "../src/reads/evaluator.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ReadSetId,
} from "../src/input-occurrence.ts";
import {
  hostNativeReadFor,
  openRecordingWriter,
  openRecordingReader,
  type HostInputLane,
} from "../src/native-recording.ts";
import { settle } from "./effect-test.ts";
import {
  fixture,
  ref,
  target,
  who,
  scope,
  path,
  key,
  gate,
  identity,
  bounds,
  snapshot,
} from "./host-read-graph.test-support.ts";

test("HTTP document targets normalize once before generated native handles and preserve the mark fence", async () => {
  const tables = nativeRead("ducts.tables");
  const definition = read("test.document-target", {
    input: familiesViewArgs,
    output: tables.output,
    run: (ctx, args) =>
      ctx.read(tables, {
        role: "acquire",
        target: { kind: "document" as const, ref: args.target },
        request: { ids: [] },
      }),
  });
  const unregister = registeredReads.register({ document: definition });
  const f = await fixture();
  try {
    for (const target of [ref, { kind: "document", ref }]) {
      const response = await f.probe({
        read: definition.name,
        subscription: "document-handle",
        generation: 1,
        args: { target },
      });
      const body = (await response.json()) as {
        state: string;
        value: { trace: { name: string; args: unknown }[] };
      };
      expect(response.status).toBe(200);
      expect(body.state).toBe("current");
      expect(body.value.trace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "native",
            args: expect.objectContaining({ target: { kind: "document", ref } }),
          }),
          expect.objectContaining({ name: "document-mark", args: ref }),
        ]),
      );
    }
    const calls = f.nativeCalls;
    const denied = await f.probe({
      read: definition.name,
      subscription: "wrong-target",
      generation: 1,
      args: { target: { kind: "host" } },
    });
    expect(denied.status).not.toBe(200);
    expect(f.nativeCalls).toBe(calls);
    for (const target of [
      { kind: "session", session: ref.session },
      { kind: "document", ref: { session: ref.session } },
    ]) {
      const refused = await f.probe({
        read: definition.name,
        subscription: "invalid-target",
        generation: 1,
        args: { target },
      });
      expect(refused.status).not.toBe(200);
      expect(f.nativeCalls).toBe(calls);
    }
    expect(() => nativeRead("ducts.apply")).toThrow("Read/Read");
  } finally {
    unregister();
    await f.close();
  }
});

test("History reopens the host's exact publication after newer Values, with no live fill", async () => {
  const f = await fixture(true);
  try {
    const first = await f.send(0, []);
    expect(first.state, first.reason).toBe("current");
    const listed = await f.history(`?document=${encodeURIComponent(path)}`);
    expect(listed.points, listed.problem).toHaveLength(1);
    expect(
      (await f.history(`?document=${encodeURIComponent(path.toUpperCase())}`)).points,
    ).toHaveLength(1);
    const point = historyPointSchema.parse(
      await f.history("", { kind: "captured", document: path }),
    );
    const fan = first.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
    const next = await f.send(1, [`${fan.uniqueId}@${fan.portIndex}`]);
    expect(next.state, next.reason).toBe("current");
    expect(next.value!.evaluation).not.toBe(first.value!.evaluation);
    const calls = f.nativeCalls;
    const opened = await f.send(2, [], undefined, "new-browser", false, point.id);
    expect(opened).toEqual({ ...first, generation: 2 });
    expect(f.nativeCalls).toBe(calls);
    const stored = await f.history(`?at=${point.id}`);
    expect(stored.work.length).toBeGreaterThan(0);
    const reader = await settle(openRecordingReader(join(f.dir, "recording"), identity, bounds));
    const cold = new History(reader, settle);
    expect(await cold.publication(point.id, "fans.sheet", "fans.sheet")).toEqual(first);
    await expect(cold.publication(point.id, "never-published", "fans.sheet")).rejects.toThrow(
      "never published",
    );
    await expect(cold.publication(point.id, "fans.sheet", "fans.sheet", next.key)).rejects.toThrow(
      "never published",
    );
    expect(() => cold.capture(path)).toThrow();
    f.changed();
    const stale = historyPointSchema.parse(
      await f.history("", { kind: "captured", document: path }),
    );
    expect(stale.history.publications[0]!.state).toBe("refresh-needed");
    expect((await cold.publication(point.id, "fans.sheet", "fans.sheet")) as object).toEqual(first);
    const publications = new Publications();
    let revision = 0,
      committed = false;
    const input = leaf("input", z.null(), z.number());
    const definition = read("persist-fence", {
      input: z.null(),
      output: z.number(),
      run: (ctx) => ctx.read(input, null),
    });
    const port = {
      evaluation: "inputs",
      origin: {},
      take: async () => 1,
      revision: () => revision,
    };
    const initial = await publications.publish("slot", 0, definition, null, port);
    const invalidated = await publications.publish("slot", 1, definition, null, port, async () => {
      revision++;
      return () => {
        committed = true;
      };
    });
    expect(invalidated).toMatchObject({
      state: "refresh-needed",
      version: initial.version,
      value: { evaluation: initial.value!.evaluation },
    });
    expect(committed).toBe(false);
  } finally {
    await f.close();
  }
}, 60_000);

test("F1 MUAS-1 -> FC-23 -> MUAS-1 never publishes an old generation, including equal args", async () => {
  const f = await fixture();
  const a = gate(),
    b = gate();
  try {
    const initial = await f.send(0, []);
    expect(initial.state, initial.reason).toBe("current");
    const rows = initial.value!.data.fans.rows;
    const fan = (mark: string) => {
      const row = rows.find((row) => row.mark === mark);
      expect(row).toBeDefined();
      return `${row!.uniqueId}@${row!.portIndex}`;
    };
    const first = f.send(1, [fan("MUAS-1")], a);
    await a.entered.promise;
    const middle = f.send(2, [fan("FC-23")], b);
    await b.entered.promise;
    const current = await f.send(3, [fan("MUAS-1")]);
    expect(current.state, current.reason).toBe("current");
    expect(current.value!.data.open!.overview.fan!.mark).toBe("MUAS-1");
    b.release.resolve();
    expect((await middle).state).toBe("superseded");
    a.release.resolve();
    expect((await first).state).toBe("superseded");
    expect((await f.send(4, [fan("MUAS-1")])).version).toBeGreaterThan(current.version);
    await f.send(1, [fan("MUAS-1")], undefined, "released-before-admission", true);
    expect((await f.send(1, [fan("MUAS-1")], undefined, "released-before-admission")).state).toBe(
      "superseded",
    );
    // Equal recipe and generation cannot make another subscription consume this one's input set.
    const other = gate();
    const held = f.send(1, [fan("MUAS-1")], other, "left");
    await other.entered.promise;
    try {
      const independent = await f.send(1, [fan("MUAS-1")], undefined, "right");
      expect(independent.state, independent.reason).toBe("current");
      other.release.resolve();
      const own = await held;
      expect(own.value!.inputs).not.toBe(independent.value!.inputs);
    } finally {
      other.release.resolve();
      await held;
    }
  } finally {
    a.release.resolve();
    b.release.resolve();
    await f.close();
  }
});

test("F2 Work, same-version firm criteria and document mark changes during a multi-read Fans evaluation retain the labelled old Value", async () => {
  for (const cause of ["work", "firm", "mark", "same-ms-mark", "all"]) {
    const f = await fixture();
    let hold: ReturnType<typeof gate> | undefined;
    try {
      const roster = await f.send(0, []);
      const row = roster.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
      const selected = [`${row.uniqueId}@${row.portIndex}`];
      const before = await f.send(1, selected);
      expect(before.state, before.reason).toBe("current");
      hold = f.holdNative();
      const pending = f.send(2, selected);
      await hold.entered.promise;
      if (cause === "work" || cause === "all") {
        const staged = await f.workspace.apply(
          key("fans"),
          "fans",
          "human",
          [{ path: ["flows", "4", "edit"], value: { value: { cfm: 321 } } }],
          0,
        );
        expect(staged.ok).toBe(true);
      }
      if (cause === "firm" || cause === "all")
        await writeFile(
          join(f.dir, "firm.json"),
          JSON.stringify({
            ...FIRM_SEED,
            criteria: { ...FIRM_SEED.criteria, terminalDropInWg: 0.4 },
          }),
        );
      if (cause === "mark" || cause === "same-ms-mark" || cause === "all")
        f.changed(cause === "same-ms-mark");
      hold.release.resolve();
      const result = await pending;
      if (cause === "work" || cause === "all") {
        // Start-capture supersedes the pending request, not the retained publication.
        expect(result.state, `${cause}: ${result.reason}`).toBe("superseded");
        expect(result.value).toBeNull();
      } else {
        expect(result.state, `${cause}: ${result.reason}`).toBe("refresh-needed");
        expect(result.value!.evaluation).toBe(before.value!.evaluation);
        expect(result.value!.freshness).toBe("refresh-needed");
        expect(result.version).toBe(before.version);
      }
      // The surface still holds the old Value and receives its exact version with a stale label.
      expect(await f.publicationEvent(2)).toEqual({
        generation: 2, version: before.version, state: "refresh-needed",
      });
    } finally {
      hold?.release.resolve();
      await f.close();
    }
  }
}, 60_000);

test("F3 three native batches retain the middle refusal on offline replay; no live bridge is constructed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "host-read-refused-"));
  const writer = await settle(openRecordingWriter(join(dir, "recording"), identity, bounds));
  let liveCalls = 0,
    poison = 0;
  const batch = leaf("native-batch", z.array(z.number()), z.array(z.number()), false);
  const definition = read("three-batches", {
    input: z.null(),
    output: z.array(z.array(z.number())),
    async run(ctx) {
      return [
        ...(await ctx.collect([1, 2, 3], {
          read: batch,
          args: (keys) => [...keys],
          batch: 1,
          covered: (keys) => keys,
        })),
      ];
    },
  });
  const make = (lane: HostInputLane) => {
    const live = Layer.unwrap(
      Effect.sync(() => {
        if (lane.kind !== "live") {
          poison++;
          throw Error("Live bridge constructed by offline replay");
        }
        return Layer.succeed(HostNativeRead, {
          resolve: () => Effect.die("not requested"),
          read: (request) => {
            liveCalls++;
            const id = (request.input as { selector: { systemIds: number[] } }).selector
              .systemIds[0]!;
            if (id === 2)
              return Effect.fail(
                new BridgeError("Partition 2 refused", 409, { notDispatched: true }),
              );
            return Effect.succeed({
              value: Schema.decodeUnknownSync(Schema.Json)({
                ...snapshot,
                systems: [
                  {
                    ...snapshot.systems[0],
                    id,
                    name: `system-${id}`,
                    classification: "Supply Air",
                    criticalPath: [],
                    sections: [],
                  },
                ],
              }),
              nativeRequestId: `batch-${id}`,
              actualTarget: target,
              freshness: { freshnessGeneration: "g1" },
              cost: {},
              outcome: "committed" as const,
            });
          },
        });
      }),
    );
    const publications = new Publications();
    return HttpRouter.toWebHandler(
      Layer.unwrap(
        Effect.gen(function* () {
          const native = yield* HostNativeRead,
            sets = yield* HostInputReadSets;
          return HttpRouter.add("POST", "/probe", (request) =>
            Effect.gen(function* () {
              const body = yield* request.json;
              const selected = z.object({ readSet: z.string().nullable() }).parse(body).readSet;
              const root = yield* sets.open(
                { key: definition.name, input: null, scope: canonicalJson(scope) },
                selected as ReadSetId | null,
              );
              const context =
                yield* Effect.context<
                  import("@pe/host-internal/request-contracts").RequestIdentity
                >();
              const run = <A, E>(
                effect: Effect.Effect<
                  A,
                  E,
                  import("@pe/host-internal/request-contracts").RequestIdentity
                >,
              ) =>
                settle(Effect.provide(effect, Context.add(context, CurrentInputConsumption, root)));
              try {
                const result = yield* Effect.promise(() =>
                  publications.publish("probe", 0, definition, null, {
                    evaluation: root.id,
                    origin: lane.kind,
                    revision: () => 0,
                    take: async (_name, ids) => {
                      try {
                        const result = await run(
                          native.read({
                            key: "ducts.snapshot.walk",
                            input: { selector: { kind: "systems", systemIds: ids } },
                            scope,
                          }),
                        );
                        return nativeResponseSchema("ducts.snapshot.walk")
                          .parse(result.value)
                          .systems.map((system) => system.id);
                      } catch (error) {
                        if (error instanceof BridgeError && error.outcome === "refused")
                          throw new RefusedPartition(error.message);
                        throw error;
                      }
                    },
                  }),
                );
                yield* root.seal;
                return HttpServerResponse.jsonUnsafe(result);
              } finally {
                yield* root.close;
              }
            }),
          );
        }),
      ).pipe(
        Layer.provide(hostNativeReadFor(lane, live)),
        Layer.provide(HostInputReadSets.layer(lane)),
      ),
      { disableLogger: true },
    );
  };
  const send = async (web: ReturnType<typeof make>, readSet: string | null) => {
    const response = await web.handler(
      new Request("http://host/probe", { method: "POST", body: JSON.stringify({ readSet }) }),
      Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  let live: ReturnType<typeof make> | undefined, replay: ReturnType<typeof make> | undefined;
  try {
    live = make({ kind: "live", captureStore: writer });
    const before = await send(live, null);
    expect(before.state, before.reason).toBe("current");
    expect(before.value.evaluation).not.toBe(before.value.inputs);
    expect(before.value.coverage).toEqual({
      requested: ["1", "2", "3"],
      covered: ["1", "3"],
      unknown: [],
      refused: [{ keys: ["2"], reason: "Partition 2 refused" }],
    });
    expect(liveCalls).toBe(3);
    await live.dispose();
    live = undefined;
    const reader = await settle(openRecordingReader(join(dir, "recording"), identity, bounds));
    replay = make({ kind: "recording", recordingStore: reader, at: null });
    const after = await send(replay, before.value.inputs);
    expect(after.state, after.reason).toBe("current");
    expect(after.value.evaluation).toBe(before.value.evaluation);
    expect(after.value.data).toEqual(before.value.data);
    expect(after.value.coverage).toEqual(before.value.coverage);
    expect(after.value.trace).toEqual(before.value.trace);
    expect(poison).toBe(0);
    expect(liveCalls).toBe(3);
  } finally {
    await live?.dispose();
    await replay?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
