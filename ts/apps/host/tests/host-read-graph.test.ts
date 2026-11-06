import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { address, bindWork } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import type { RouteWorkspace } from "@pe/runtime";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../packages/host-contracts/src/fixtures/k2-roster.json" with { type: "json" };
import fanCapture from "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json" with { type: "json" };
import { fansInputRoutes } from "../src/app.ts";
import { Publications, read, leaf, RefusedPartition } from "../src/reads/evaluator.ts";
import { fansReadResponse } from "../../../packages/agent-contracts/src/fans-read.ts";
import { HostInputContext } from "../src/input-context.ts";
import { HostFiles } from "../src/host-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ReadSetId,
} from "../src/input-occurrence.ts";
import {
  hostNativeReadFor,
  nativeCatalogIdentity,
  openRecordingWriter,
  openRecordingReader,
  type HostInputLane,
} from "../src/native-recording.ts";
import { settle } from "./effect-test.ts";
const ref = { session: "spike", openId: "model" };
const target = {
  processIncarnation: { pid: 42, startedAt: 1 },
  openDocumentLifetime: { openId: ref.openId },
};
const who = { kind: "human" as const, via: "local" as const };
const scope = { bridgeSessionId: ref.session, openDocumentId: ref.openId };
const path = address("C:/Models/Chadds.rvt");
const key = (route: string) => bindWork(route, path, undefined, ref);
const gate = () => ({
  entered: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
});
const identity = { build: "host-read-spike", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 256 * 1024 * 1024, maxTakings: 2000 };
const roster = nativeResponseSchema("ducts.snapshot.walk").parse(rosterCapture);
const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(fanCapture);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "host-read-spike-"));
  await mkdir(join(dir, "catalogs"));
  await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  let workspace!: RouteWorkspace;
  let mark = 10,
    generation = 0,
    nativeCalls = 0;
  const markListeners = new Set<() => void>();
  const holds = new Map<string, ReturnType<typeof gate>>();
  let nativeHold: ReturnType<typeof gate> | undefined;
  const owner = new DuctsReadings();
  const marks = hostMarks({
    observedSince: 1,
    changedAt: () => mark,
    generation: () => generation,
    subscribe: (listener) => {
      markListeners.add(listener);
      return () => {
        markListeners.delete(listener);
      };
    },
  });
  const inputs = await settle(
    HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))),
  );
  const web = HttpRouter.toWebHandler(
    fansInputRoutes(inputs, {
      store: fileRouteDocumentStore(join(dir, "work")),
      initialize: async (current) => {
        workspace = current;
      },
      live: {
        owner,
        files: HostFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
        marks: Layer.succeed(HostDocumentMarks, {
          ...marks,
          snapshot: (doc) =>
            Effect.gen(function* () {
              const request = yield* Effect.serviceOption(RequestIdentity);
              const requestId = request._tag === "Some" ? request.value.requestId : "";
              const hold = holds.get(requestId);
              if (hold) {
                holds.delete(requestId);
                hold.entered.resolve();
                yield* Effect.promise(() => hold.release.promise);
              }
              return yield* marks.snapshot(doc);
            }),
        }),
        inventory: Layer.succeed(HostSessionInventory, {
          document: () => Effect.succeed({ ...ref, address: path }),
          session: () => Effect.succeed({ sessionId: ref.session }),
          attachment: () => Effect.succeed({ sessionId: ref.session }),
          list: () => Effect.die("No inventory list requested"),
          subscribe: () => () => {},
        }),
        native: Layer.succeed(HostNativeRead, {
          resolve: (input) =>
            Effect.succeed({
              ...target,
              operationKey: input.key,
              normalizedInput: canonicalJson(JSON.parse(JSON.stringify(input.input))),
              freshnessGeneration: "g1",
              representation: "overview",
            }),
          read: (input) =>
            Effect.gen(function* () {
              nativeCalls++;
              const hold = nativeHold;
              if (hold && input.key === "ducts.snapshot.walk") {
                nativeHold = undefined;
                hold.entered.resolve();
                yield* Effect.promise(() => hold.release.promise);
              }
              return {
                value: Schema.decodeUnknownSync(Schema.Json)(
                  input.key === "ducts.tables"
                    ? {
                        folder: "captured",
                        tables: {},
                        missing: (input.input as { ids: string[] }).ids,
                        unsupported: {},
                      }
                    : input.key === "ducts.snapshot.roster"
                      ? roster
                      : snapshot,
                ),
                nativeRequestId: `native-${nativeCalls}`,
                actualTarget: target,
                freshness: { freshnessGeneration: "g1" },
                cost: {},
                outcome: "committed" as const,
              };
            }),
        }),
      },
    }),
    { disableLogger: true },
  );
  const send = async (generation: number, fan: string[], hold?: ReturnType<typeof gate>) => {
    const admitted = admittedRequestIdentity(who, scope);
    if (hold) holds.set(admitted.requestId, hold);
    const response = await withInvocationContext({ caller: who }, () =>
      web.handler(
        new Request("http://host/pe/fans/sheet", {
          method: "POST",
          body: JSON.stringify({
            subscription: "sheet",
            generation,
            args: { target: ref, fan, sheetPath: "" },
          }),
        }),
        Context.make(RequestIdentity, admitted),
      ),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return fansReadResponse.parse(await response.json());
  };
  return {
    dir,
    send,
    get workspace() {
      return workspace;
    },
    changed(sameMillisecond = false) {
      if (!sameMillisecond) mark++;
      generation++;
      for (const notify of markListeners) notify();
    },
    holdNative() {
      owner.refresh(ref);
      nativeHold = gate();
      return nativeHold;
    },
    async close() {
      nativeHold?.release.resolve();
      for (const hold of holds.values()) hold.release.resolve();
      await web.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

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
      expect(result.state, `${cause}: ${result.reason}`).toBe("refresh-needed");
      expect(result.value!.evaluation).toBe(before.value!.evaluation);
      expect(result.value!.freshness).toBe("refresh-needed");
      expect(result.version).toBe(before.version);
    } finally {
      hold?.release.resolve();
      await f.close();
    }
  }
});

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
    const after = await send(replay, before.value.evaluation);
    expect(after.state, after.reason).toBe("current");
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
