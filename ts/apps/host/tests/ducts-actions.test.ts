/**
 * /ducts verbs over the production bridge with a fake socket (`bridge-fixture.ts`): preview and
 * apply are one native op, `ducts.apply`, and the host only adds `previewOnly`. The request the
 * web built reaches Revit byte for byte; a document that is not the admitted one never dispatches.
 */
import { connectTestBridge } from "./bridge-fixture.ts";
import { originalProcess, sdkEnvelope, sdkSessions } from "./native-receipt-fixture.ts";
import { asCaller, crossingOf, human } from "./callers.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Queue } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import {
  bindWork,
  commands,
  ductsRouteState,
  type WorkKey,
  type DuctsActionKey,
  type DuctsApplyInput,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";

const metrics = {
  requestBytes: 0,
  responseBytes: 0,
  revitExecutionMs: 0,
  roundTripMs: 0,
  serializationMs: 0,
};

const input: DuctsApplyInput = {
  slots: { fanStatic: "PE_ESP" },
  fittings: [
    {
      id: 22,
      method: "pe-server",
      coefficient: 1.38,
      table: "SD5-10",
      inputs: "Qb/Qc=0.25",
      ruleKey: "tap-std",
    },
  ],
  terminals: [{ id: 31, inWg: 0.08, source: "catalog" }],
  components: [],
  equipment: [{ id: 1, externalStaticInWg: 0.1102 }],
  terminalFlows: [{ id: 31, cfm: 120, source: "revit" }],
  equipmentFlows: [{ id: 1, cfm: 1800, source: "submittal" }],
  store: {
    version: 1,
    rules: { "tap-std": { table: "SD5-10" } },
    instances: {
      "22": {
        table: "SD5-10",
        inputs: "Qb/Qc=0.25",
        coefficient: 1.38,
        appliedAt: "2026-10-04T00:00:00.000Z",
      },
    },
    terminals: {
      "31": { inWg: 0.08, source: "catalog", appliedAt: "2026-10-04T00:00:00.000Z" },
    },
    slots: { fanStatic: "PE_ESP" },
    workRevision: 4,
    // A key a later store version adds passes through untouched ([JsonExtensionData]).
    pressureClass: "low",
    appliedAt: "2026-10-04T00:00:00.000Z",
  },
};

const lane = <A>(body: (h: Harness) => Effect.Effect<A, unknown, never>, sdk = sdkSessions) =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "pe-ducts-")));
    const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
    const rows = new Map<string, unknown>();
    const work = new RouteWorkspace({
      registrations: [{ spec: ductsRouteState }],
      store: {
        getState: async ({ targetKey, route }) => rows.get(targetKey + route),
        setState: async ({ targetKey, route, value }) => {
          rows.set(targetKey + route, structuredClone(value));
        },
      },
    });
    const workKey = bindWork("ducts", null, undefined, target);
    const owner = new ActionJournal(join(dir, "attempts.json"));
    const web = HttpRouter.toWebHandler(
      makeCallRoute(owner, new TakeoffCaptures(join(dir, "captures")), {
        sdk,
        workspace: work,
      }).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true },
    );
    const post = (body: unknown) =>
      Effect.promise(() =>
        asCaller(human, web.handler)(
          new Request("http://host/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          Context.empty() as never,
        ),
      );
    const answer = (requestId: string, value: unknown, lost = false) =>
      Queue.offer(
        incoming,
        JSON.stringify({
          kind: "Response",
          response: {
            requestId,
            metrics,
            ok: !lost,
            statusCode: lost ? 504 : 200,
            ...(lost
              ? {
                  errorMessage: "native reply lost",
                  issues: [
                    {
                      instancePath: "$",
                      code: "TimedOut",
                      message: "reply lost",
                      severity: "error",
                    },
                  ],
                }
              : {}),
            payloadJson: JSON.stringify(value),
          },
        }),
      );
    const intent = (
      id: string,
      key: DuctsActionKey,
      openId = target.openId,
      payload: unknown = input,
    ) => ({
      id,
      key,
      target: { kind: "document" as const, ref: { ...target, openId } },
      input: payload,
    });
    try {
      return yield* body({ owner, outgoing, post, answer, intent, work, workKey });
    } finally {
      yield* Effect.promise(() => web.dispose());
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
    }
  }).pipe(Effect.scoped, Effect.provide(RevitBridgeLive), (effect) =>
    Effect.runPromise(effect as Effect.Effect<A>),
  );

type Harness = {
  work: RouteWorkspace;
  workKey: WorkKey;
  owner: ActionJournal;
  outgoing: Queue.Queue<import("@pe/host-contracts/contracts").BridgeFrame>;
  post: (body: unknown) => Effect.Effect<Response>;
  answer: (requestId: string, value: unknown, lost?: boolean) => Effect.Effect<boolean>;
  intent: (
    id: string,
    key: DuctsActionKey,
    openId?: string,
    payload?: unknown,
  ) => Record<string, unknown> & { id: string };
};

const writes = (outcome: string) => ({
  previewOnly: outcome === "planned",
  writes: [{ id: 22, kind: "fitting", outcome, reason: null, before: null, after: "1.38" }],
  counts: { planned: 0, written: 0, refused: 0, unchanged: 0, [outcome]: 1 },
  systemsAfter: [],
  storeRevision: outcome === "planned" ? 0 : 4,
});

test("preview and apply send the web's request to ducts.apply, differing only in previewOnly", () =>
  lane(({ owner, outgoing, post, answer, intent }) =>
    Effect.gen(function* () {
      for (const [id, key, outcome] of [
        ["preview-1", "ducts.preview-losses", "planned"],
        ["apply-1", "ducts.apply-losses", "written"],
      ] as const) {
        expect((yield* post(intent(id, key))).status).toBe(202);
        const frame = yield* Queue.take(outgoing);
        expect(frame.request?.operationKey).toBe("ducts.apply");
        expect(JSON.parse(frame.request!.payloadJson)).toEqual({
          ...input,
          previewOnly: key === "ducts.preview-losses",
        });
        yield* answer(frame.request!.requestId, writes(outcome));
        const row = (yield* Effect.promise(() => owner.wait(id))) as {
          state: string;
          result: { value: unknown };
        };
        expect(row.state).toBe("succeeded");
        expect(row.result.value).toEqual(writes(outcome));
      }
    }),
  ));

test("a request for another document lifetime, or with a caller's previewOnly, never dispatches", () =>
  lane(({ owner, outgoing, post, intent }) =>
    Effect.gen(function* () {
      // Admission answers first; the lifetime check runs before any native step and refuses it.
      yield* post(intent("gone", "ducts.apply-losses", "closed-open"));
      const gone = (yield* Effect.promise(() => owner.wait("gone"))) as {
        state: string;
        steps: unknown[];
      };
      expect(gone.state).not.toBe("succeeded");
      expect(gone.steps).toEqual([]);
      const smuggled = intent("smuggled", "ducts.apply-losses");
      const bad = yield* post({ ...smuggled, input: { ...input, previewOnly: false } });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(yield* Queue.size(outgoing)).toBe(0);
    }),
  ));

test("semantic refresh yields a snapshot-dirty receipt without dispatching a native operation", () =>
  lane(({ owner, outgoing, post, intent }) =>
    Effect.gen(function* () {
      expect((yield* post(intent("refresh-1", "ducts.refresh", undefined, {}))).status).toBe(202);
      const row = yield* Effect.promise(() => owner.wait("refresh-1"));
      expect(row?.state, JSON.stringify(row)).toBe("succeeded");
      expect(commands["ducts.refresh"].dirties).toEqual(["snapshot"]);
      expect(row).toMatchObject({ key: "ducts.refresh", effects: [] });
      expect(yield* Queue.size(outgoing)).toBe(0);
    }),
  ));

test("a successful apply retires landed consumed cells, retaining held ESP, refused drops and concurrent edits", () =>
  lane(({ owner, outgoing, post, answer, intent, work, workKey }) =>
    Effect.gen(function* () {
      const staged = yield* Effect.promise(() =>
        work.apply(
          workKey,
          "ducts",
          "human",
          [
            { path: ["flows", "31", "edit"], value: { value: { cfm: 120 } } },
            { path: ["flows", "32", "edit"], value: { value: { cfm: 130 } } },
            { path: ["esp", "1", "edit"], value: { value: { inWg: 0.1 } } },
            { path: ["terminalDrops", "31", "edit"], value: { value: { inWg: 0.08 } } },
          ],
          0,
        ),
      );
      expect(staged.ok).toBe(true);
      yield* post(
        intent("retire-losses", "ducts.apply-losses", undefined, {
          ...input,
          equipment: [],
          terminalFlows: [
            { id: 31, cfm: 120 },
            { id: 32, cfm: 130 },
          ],
          work: { key: workKey, revision: staged.revision },
        }),
      );
      const frame = yield* Queue.take(outgoing);
      const edited = yield* Effect.promise(() =>
        work.apply(
          workKey,
          "ducts",
          "human",
          [{ path: ["flows", "31", "edit"], value: { value: { cfm: 150 } } }],
          staged.revision!,
        ),
      );
      expect(edited.ok).toBe(true);
      yield* answer(frame.request!.requestId, {
        ...writes("written"),
        writes: [
          { kind: "terminal-flow", id: 31, outcome: "written" },
          { kind: "terminal-flow", id: 32, outcome: "unchanged" },
          { kind: "terminal", id: 31, outcome: "refused", reason: "read only" },
        ],
      });
      const receipt = yield* Effect.promise(() => owner.wait("retire-losses"));
      expect(receipt?.state, JSON.stringify(receipt)).toBe("succeeded");
      const current = yield* Effect.promise(() => work.read(workKey, "ducts"));
      const doc = ductsRouteState.schema.parse(current!.doc);
      expect(doc.flows["32"]?.edit).toBeNull();
      expect(doc.flows["31"]?.edit?.value.cfm).toBe(150);
      expect(doc.esp["1"]?.edit?.value.inWg).toBe(0.1);
      expect(doc.terminalDrops["31"]?.edit?.value.inWg).toBe(0.08);
      expect(receipt?.steps.filter((step) => step.key === "work.retire")).toHaveLength(1);
    }),
  ));

const heal = {
  groups: [
    {
      group: "g10",
      items: [
        { key: "cap:10:0", kind: "cap", end: "10:0" },
        { key: "join:10:1|11:0", kind: "join", end: "10:1", other: "11:0" },
      ],
    },
  ],
};
const healed = (outcome: string) => ({
  previewOnly: outcome === "planned",
  groups: [{ group: "g10", outcome, reason: null, items: [], systemsBefore: [], systemsAfter: [] }],
  counts: {
    planned: outcome === "planned" ? 2 : 0,
    healed: outcome === "healed" ? 2 : 0,
    refused: 0,
  },
});

test("heal preview and apply send the route's items to ducts.heal, differing only in previewOnly", () =>
  lane(({ owner, outgoing, post, answer, intent }) =>
    Effect.gen(function* () {
      for (const [id, key, outcome] of [
        ["heal-preview-1", "ducts.preview-heal", "planned"],
        ["heal-apply-1", "ducts.apply-heal", "healed"],
      ] as const) {
        expect((yield* post(intent(id, key, undefined, heal))).status).toBe(202);
        const frame = yield* Queue.take(outgoing);
        expect(frame.request?.operationKey).toBe("ducts.heal");
        expect(JSON.parse(frame.request!.payloadJson)).toEqual({
          ...heal,
          previewOnly: key === "ducts.preview-heal",
        });
        yield* answer(frame.request!.requestId, healed(outcome));
        const row = (yield* Effect.promise(() => owner.wait(id))) as {
          state: string;
          result: { value: unknown };
        };
        expect(row.state).toBe("succeeded");
        expect(row.result.value).toEqual(healed(outcome));
      }
    }),
  ));

test("assign-fan preview and apply send the pair to ducts.assign-fan, differing only in previewOnly", () =>
  lane(({ owner, outgoing, post, answer, intent }) =>
    Effect.gen(function* () {
      const pair = { systemId: 6103113, unitId: 9668311 };
      for (const [id, key, outcome] of [
        ["fan-preview-1", "ducts.preview-assign-fan", "planned"],
        ["fan-apply-1", "ducts.apply-assign-fan", "assigned"],
      ] as const) {
        expect((yield* post(intent(id, key, undefined, pair))).status).toBe(202);
        const frame = yield* Queue.take(outgoing);
        expect(frame.request?.operationKey).toBe("ducts.assign-fan");
        const sent = { ...pair, previewOnly: key === "ducts.preview-assign-fan" };
        expect(JSON.parse(frame.request!.payloadJson)).toEqual(sent);
        const reply = { ...sent, outcome, reason: null, connector: 1, check: "ok" };
        yield* answer(frame.request!.requestId, reply);
        const row = (yield* Effect.promise(() => owner.wait(id))) as {
          state: string;
          result: { value: unknown };
        };
        expect(row.state).toBe("succeeded");
        expect(row.result.value).toEqual(reply);
      }
      const bad = yield* post(
        intent("fan-bad", "ducts.apply-assign-fan", undefined, { systemId: 1 }),
      );
      expect(bad.status).toBeGreaterThanOrEqual(400);
    }),
  ));

test("a group-only heal seals snapshot items and recovers without replanning or duplicate dispatch", async () => {
  let witness: unknown;
  await lane(
    ({ owner, outgoing, post, answer, intent }) =>
      Effect.gen(function* () {
        const id = "heal-recovery";
        expect(
          (yield* post(intent(id, "ducts.apply-heal", undefined, { groups: [{ group: "g10" }] })))
            .status,
        ).toBe(202);
        const snapshot = yield* Queue.take(outgoing);
        expect(snapshot.request?.operationKey).toBe("ducts.snapshot");
        yield* answer(snapshot.request!.requestId, {
          nodes: [],
          groups: [],
          issues: [],
          segments: [
            {
              id: 10,
              kind: "duct",
              groupId: "g10",
              classification: "SupplyAir",
              polyline: [
                [0, 0, 0],
                [10, 0, 0],
              ],
              connectors: [
                {
                  index: 0,
                  kind: "end",
                  point: [0, 0, 0],
                  shape: "round",
                  diameterIn: 6,
                  connectedTo: null,
                },
              ],
            },
          ],
        });
        const native = yield* Queue.take(outgoing),
          request = native.request!;
        expect(request.operationKey).toBe("ducts.heal");
        const sealed = JSON.parse(request.payloadJson);
        expect(sealed).toEqual({
          groups: [{ group: "g10", items: [{ key: "cap:10:0", kind: "cap", end: "10:0" }] }],
          previewOnly: false,
        });
        yield* answer(request.requestId, null, true);
        const uncertain = yield* Effect.promise(() => owner.wait(id));
        expect(uncertain?.state).toBe("unknown");
        expect(uncertain?.prepared).toMatchObject({
          state: "ready",
          value: { input: sealed, process: originalProcess },
        });
        witness = {
          state: "ok",
          requestId: request.requestId,
          receipt: {
            requestId: request.requestId,
            key: "ducts.heal",
            pid: originalProcess.pid,
            processStartUtc: originalProcess.processStartUtc,
            verdict: "ok",
            responsePath: "exact-native-response",
            startedUtc: originalProcess.processStartUtc,
            completedUtc: "1970-01-01T00:00:02.0000000Z",
          },
          response: healed("healed"),
        };
        const recovered = yield* Effect.promise(() => owner.recover(id));
        expect(recovered.steps[0]).toMatchObject({
          state: "succeeded",
          input: sealed,
          result: healed("healed"),
        });
        yield* Effect.promise(() => owner.resume(id, crossingOf("human")));
        const completed = yield* Effect.promise(() => owner.wait(id));
        expect(completed).toMatchObject({
          state: "succeeded",
          result: { value: healed("healed") },
        });
        expect(yield* Queue.size(outgoing)).toBe(0);
      }),
    async (args = []) => (args[0] === "op" ? sdkEnvelope(witness) : sdkSessions(args)),
  );
});
