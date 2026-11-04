/** Port of main .artifacts/runs/review-20261030-ducts/contracts/contracts-review/
 * write-repro.cjs and repro.cjs (2026-10-30). Real journal, executor, workspace and
 * route handler; stand-in native socket and SDK receipts. No host or Revit process.
 * These are ordinary failing tests, not test.fails: missing kernel primitives stay red.
 */
import { captureStore } from "./effect-test.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { originalProcess, sdkEnvelope, sdkSessions } from "./native-receipt-fixture.ts";
import { asCaller, crossingOf, human } from "./callers.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Queue } from "effect";
import { HttpRouter } from "effect/http";
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
  terminalFlows: [{ id: 31, cfm: 999, source: "revit" }],
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
      makeCallRoute(owner, captureStore(join(dir, "captures")), {
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
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await web.dispose();
        await rm(dir, { recursive: true, force: true });
      }),
    );
    return yield* body({ owner, outgoing, post, answer, intent, work, workKey, target });
  }).pipe(Effect.scoped, Effect.provide(RevitBridgeLive), (effect) =>
    // effect-edge: island, phase 5
    Effect.runPromise(effect as Effect.Effect<A>),
  );

type Harness = {
  target: { session: string; openId: string };
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

import { snapshot } from "../../web/src/ducts/test-fixture.ts";
import { createDuctsSheets } from "../src/ducts-sheet.ts";

const response = {
  previewOnly: false,
  writes: [
    {
      kind: "terminal-flow",
      id: 31,
      outcome: "written",
      reason: null,
      before: "200",
      after: "999",
    },
  ],
  counts: { planned: 0, written: 1, unchanged: 0, refused: 0 },
  systemsAfter: [],
  storeRevision: 1,
};
const edit = (cfm: number) => [
  { path: ["flows", "31", "edit"], value: { value: { cfm } } },
  { path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } },
];
const rawDispatchOrReceipt = (owner: ActionJournal, outgoing: Harness["outgoing"], id: string) =>
  Effect.race(
    Queue.take(outgoing).pipe(Effect.map((frame) => ({ kind: "dispatch" as const, frame }))),
    Effect.promise(() => owner.wait(id)).pipe(
      Effect.map((receipt) => ({ kind: "receipt" as const, receipt })),
    ),
  );

const dispatchOrReceipt = (
  owner: ActionJournal,
  outgoing: Harness["outgoing"],
  id: string,
  answer: Harness["answer"],
): Effect.Effect<any> =>
  Effect.gen(function* () {
    while (true) {
      const next = yield* rawDispatchOrReceipt(owner, outgoing, id);
      if (next.kind === "receipt") return next;
      const request = next.frame.request!;
      if (request.operationKey.startsWith("ducts.snapshot."))
        yield* answer(request.requestId, snapshot);
      else if (request.operationKey === "ducts.tables")
        yield* answer(request.requestId, { tables: {}, missing: [], unsupported: [] });
      else return next;
    }
  });

for (const foreign of [false, true])
  // "U4: fan cells reach apply-losses only through the fans Work"
  test.skip(`kernel gap: ${foreign ? "Work A cannot write document B" : "native payload must derive from Work, not caller"}`, () =>
    lane(({ owner, outgoing, post, answer, intent, work, workKey, target }) =>
      Effect.gen(function* () {
        const key = foreign
          ? bindWork("ducts", null, undefined, { session: target.session, openId: "other-open" })
          : workKey;
        const staged = yield* Effect.promise(() => work.apply(key, "ducts", "human", edit(200), 0));
        if (!staged.ok) throw Error("Expected accepted staged Work");
        const submitted = yield* post(
          intent(
            "mismatch",
            "ducts.apply-losses",
            undefined,
            foreign
              ? {
                  work: { key, revision: staged.revision },
                }
              : {
                  ...input,
                  work: { key, revision: staged.revision },
                },
          ),
        );
        if (!foreign) {
          expect(submitted.status).toBeGreaterThanOrEqual(400);
          expect(yield* Queue.size(outgoing)).toBe(0);
          return;
        }
        const next = yield* dispatchOrReceipt(owner, outgoing, "mismatch", answer);
        if (next.kind === "receipt") {
          expect(next.receipt).toMatchObject({
            state: "failed",
            notDispatched: true,
            refusal: { kind: "domain" },
          });
          return;
        }
        const frame = next.frame;
        const native = JSON.parse(frame.request!.payloadJson);
        yield* answer(frame.request!.requestId, response);
        const receipt = yield* Effect.promise(() => owner.wait("mismatch"));
        if (foreign)
          expect(receipt?.state, "foreign Work must be refused before native dispatch").toBe(
            "refused",
          );
        else
          expect(
            native.terminalFlows[0].cfm,
            "Work authored 200; caller dispatched 999 and retired the 200 edit",
          ).toBe(200);
      }),
    ));

test("kernel gap: sheet read cannot overwrite Work at the server revision", async () => {
  let stored: any = null;
  const work = new RouteWorkspace({
    registrations: [{ spec: ductsRouteState }],
    store: {
      getState: async () => structuredClone(stored),
      setState: async ({ value }) => {
        stored = structuredClone(value);
      },
    },
  });
  const target = { session: "s", openId: "o" };
  const key = bindWork("ducts", null, undefined, target);
  await work.apply(
    key,
    "ducts",
    "human",
    [{ path: ["flows", "101", "edit"], value: { value: { cfm: 200 } } }],
    0,
  );
  const before = structuredClone(stored);
  const sheets = createDuctsSheets(
    {
      call: async () => {
        throw Error("read unavailable");
      },
    } as never,
    { workspace: work, key: async () => key, author: () => "pea" },
  );
  await expect(
    sheets.sheet({
      target,
      mode: "fan",
      unitId: 100,
      portIndex: 0,
      basis: "obsolete-client-basis",
      edits: { flows: { 101: { cfm: 100 } } },
    }),
  ).rejects.toThrow("read unavailable");
  expect(stored, "even a failed read persisted stale edits before acquiring native data").toEqual(
    before,
  );
});

// "U4: fan cells reach apply-losses only through the fans Work"
test.skip("kernel gap: preview seal refuses apply after Work changes", () =>
  lane(({ owner, outgoing, post, answer, intent, work, workKey }) =>
    Effect.gen(function* () {
      const staged = yield* Effect.promise(() =>
        work.apply(workKey, "ducts", "human", edit(200), 0),
      );
      if (!staged.ok) throw Error("Expected accepted staged Work");
      yield* post(
        intent("preview", "ducts.preview-losses", undefined, {
          work: { key: workKey, revision: staged.revision },
        }),
      );
      const preview = yield* dispatchOrReceipt(owner, outgoing, "preview", answer);
      expect(preview.kind).toBe("dispatch");
      yield* answer(preview.frame.request!.requestId, { ...response, previewOnly: true });
      expect((yield* Effect.promise(() => owner.wait("preview")))?.state).toBe("succeeded");
      const changed = yield* Effect.promise(() =>
        work.apply(workKey, "ducts", "human", edit(300), staged.revision),
      );
      if (!changed.ok) throw Error("Expected accepted changed Work");
      yield* post(
        intent("apply", "ducts.apply-losses", undefined, {
          work: { key: workKey, revision: changed.revision },
        }),
      );
      const next = yield* dispatchOrReceipt(owner, outgoing, "apply", answer);
      if (next.kind === "receipt") {
        expect(next.receipt).toMatchObject({
          state: "failed",
          notDispatched: true,
          refusal: { kind: "domain" },
        });
        return;
      }
      yield* answer(next.frame.request!.requestId, response);
      expect(
        (yield* Effect.promise(() => owner.wait("apply")))?.state,
        "no preview seal links these invocations",
      ).toBe("refused");
    }),
  ));

// Falsified audit premise: ActionJournal's effect overlap already prevents this duplicate.
// Keep this green regression; turning it red artificially would misstate the missing primitive.
// "U4: fan cells reach apply-losses only through the fans Work"
test.skip("unknown outcome blocks a new invocation from dispatching the same write", () =>
  lane(({ owner, outgoing, post, answer, intent, work, workKey }) =>
    Effect.gen(function* () {
      const staged = yield* Effect.promise(() =>
        work.apply(workKey, "ducts", "human", edit(200), 0),
      );
      if (!staged.ok) throw Error("Expected accepted staged Work");
      const payload = { work: { key: workKey, revision: staged.revision } };
      yield* post(intent("pre-unknown", "ducts.preview-losses", undefined, payload));
      const preview = yield* dispatchOrReceipt(owner, outgoing, "pre-unknown", answer);
      expect(preview.kind).toBe("dispatch");
      yield* answer(preview.frame.request!.requestId, { ...response, previewOnly: true });
      expect((yield* Effect.promise(() => owner.wait("pre-unknown"))).state).toBe("succeeded");
      yield* post(intent("uncertain", "ducts.apply-losses", undefined, payload));
      const first = yield* dispatchOrReceipt(owner, outgoing, "uncertain", answer);
      expect(first.kind).toBe("dispatch");
      yield* answer(first.frame.request!.requestId, null, true);
      expect((yield* Effect.promise(() => owner.wait("uncertain")))?.state).toBe("unknown");
      yield* post(intent("retry", "ducts.apply-losses", undefined, payload));
      const retry = yield* Effect.promise(() => owner.wait("retry"));
      expect(retry.state, JSON.stringify(retry)).not.toBe("succeeded");
      expect(yield* Queue.size(outgoing), "unknown outcome must block duplicate dispatch").toBe(0);
    }),
  ));

// "U4: fan cells reach apply-losses only through the fans Work"
test.skip("host-derived preview and apply send the captured Work flow and retire only confirmed cells", () =>
  lane(({ owner, outgoing, post, answer, intent, work, workKey }) =>
    Effect.gen(function* () {
      const staged = yield* Effect.promise(() =>
        work.apply(
          workKey,
          "ducts",
          "human",
          [
            { path: ["flows", "4", "edit"], value: { value: { cfm: 200 } } },
            { path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } },
          ],
          0,
        ),
      );
      if (!staged.ok) throw Error("Expected accepted staged Work");
      const payload = { work: { key: workKey, revision: staged.revision } };
      for (const [id, key, previewOnly] of [
        ["preview-derived", "ducts.preview-losses", true],
        ["apply-derived", "ducts.apply-losses", false],
      ] as const) {
        yield* post(intent(id, key, undefined, payload));
        const next = yield* dispatchOrReceipt(owner, outgoing, id, answer);
        expect(next.kind, JSON.stringify(next)).toBe("dispatch");
        // The preview reaches the TransactRead leaf; only the apply entry reaches the ModelWrite leaf.
        expect(next.frame.request!.operationKey).toBe(
          previewOnly ? "ducts.apply.preview" : "ducts.apply",
        );
        const native = JSON.parse(next.frame.request!.payloadJson);
        expect(native).not.toHaveProperty("previewOnly");
        expect(native.terminalFlows.find((row: { id: number }) => row.id === 4)?.cfm).toBe(200);
        yield* answer(next.frame.request!.requestId, {
          ...response,
          previewOnly,
          writes: [{ ...response.writes[0], id: 4, after: "200" }],
        });
        const receipt = yield* Effect.promise(() => owner.wait(id));
        expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
        expect((receipt as any).result.seal.requestHash).toMatch(/^[a-f0-9]{64}$/);
      }
      const view = yield* Effect.promise(() => work.view(workKey, "ducts"));
      expect((view!.doc as any).flows["4"].edit).toBeNull();
    }),
  ));
