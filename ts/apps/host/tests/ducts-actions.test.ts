/**
 * /ducts verbs over the production bridge with a fake socket (`bridge-fixture.ts`): preview and
 * apply are one native op, `ducts.apply`, and the host only adds `previewOnly`. The request the
 * web built reaches Revit byte for byte; a document that is not the admitted one never dispatches.
 */
import { connectTestBridge } from "./bridge-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { asCaller, human } from "./callers.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Queue } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import type { DuctsActionKey, DuctsApplyInput } from "@pe/agent-contracts";
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

const lane = <A>(body: (h: Harness) => Effect.Effect<A, unknown, never>) =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "pe-ducts-")));
    const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
    const owner = new ActionJournal(join(dir, "attempts.json"));
    const web = HttpRouter.toWebHandler(
      makeCallRoute(owner, new TakeoffCaptures(join(dir, "captures")), {
        sdk: sdkSessions,
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
    const answer = (requestId: string, value: unknown) =>
      Queue.offer(
        incoming,
        JSON.stringify({
          kind: "Response",
          response: {
            requestId,
            metrics,
            ok: true,
            statusCode: 200,
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
      return yield* body({ owner, outgoing, post, answer, intent });
    } finally {
      yield* Effect.promise(() => web.dispose());
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
    }
  }).pipe(Effect.scoped, Effect.provide(RevitBridgeLive), (effect) =>
    Effect.runPromise(effect as Effect.Effect<A>),
  );

type Harness = {
  owner: ActionJournal;
  outgoing: Queue.Queue<import("@pe/host-contracts/contracts").BridgeFrame>;
  post: (body: unknown) => Effect.Effect<Response>;
  answer: (requestId: string, value: unknown) => Effect.Effect<boolean>;
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
