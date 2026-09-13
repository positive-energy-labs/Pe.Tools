import { peDo } from "../../../packages/mcps/src/pea/capability-tools.ts";
import { freezeScript } from "../src/operation-script.ts";
import sourceCatalog from "./fixtures/operation-source-catalog.json" with { type: "json" };
import { Ajv } from "ajv";
import { connectTestBridge } from "./bridge-fixture.ts";
import { submitAction } from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { test, expect, vi } from "vite-plus/test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Queue, Fiber } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { address, takeoffsRouteState } from "@pe/agent-contracts";
import {
  createRuntimeLibSqlStorage,
  readLegacyRouteState,
} from "../../../packages/runtime/src/storage/profiles.ts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge, RevitBridgeLive, BridgeError } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { type SdkReceiptReader, nativeReceiptArgs } from "../src/native-receipts.ts";
import { sdkSessions, sdkEnvelope, originalProcess } from "./native-receipt-fixture.ts";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "gateway-"));
  const database = join(directory, "mastra.db");
  const storage = await createRuntimeLibSqlStorage({ id: "gateway-test", url: `file:${database}` });
  await storage.init();
  const state = (await storage.getStore("threadState"))!;
  const census = () => readLegacyRouteState(storage);
  const journalPath = join(directory, "journal.json");
  const owner = new ActionJournal(journalPath, census);
  return {
    directory,
    database,
    storage,
    state,
    census,
    journalPath,
    owner,
    close: async () => {
      await storage.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
        (error) => {
          if (error.code !== "EBUSY") throw error;
          console.warn(`Test database retained after LibSQL close: ${directory}`);
        },
      );
    },
  };
}
function router(
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  sdk: SdkReceiptReader = sdkSessions,
) {
  const web = HttpRouter.toWebHandler(
    makeCallRoute(owner, undefined, { sdk }).pipe(
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  return {
    close: () => web.dispose(),
    call: (path: string, body?: unknown, headers?: Record<string, string>) =>
      web.handler(
        new Request(`http://host${path}`, {
          ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
          headers: { "content-type": "application/json", ...headers },
        }),
        Context.empty() as never,
      ),
  };
}
const at = address("C:/Gateway.rvt");
const destination = { kind: "session", session: "B" } as const;
const admission = (id: string) => ({
  id,
  key: "family.temporary.acquire",
  kind: "operation" as const,
  actor: "agent" as const,
  destination,
  input: { acquisitionId: id },
  bases: {},
});

test("real HTTP owner holds an external leaf while Work edits land; same ID reconstructs without dispatch and unknown blocks new intent", async () => {
  const f = await setup();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  const effects: { key: string; session?: string; openId?: string; id?: string }[] = [];
  const sessions = ["A", "B"].map((sessionId) => ({
    sessionId,
    processId: 42,
    processStartUtcUnixMs: 1000,
    state: { openDocuments: [{ openId: "original", address: at, isFamilyDocument: false }] },
  }));
  const bridge = {
    list: Effect.sync(() => sessions),
    invoke: (key: string, _input: unknown, session?: string, openId?: string, id?: string) =>
      Effect.promise(async () => {
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [
                {
                  key: "family.temporary.acquire",
                  intent: "Mutate",
                  needs: "nothing",
                  requestSchemaJson: JSON.stringify({
                    type: "object",
                    required: ["acquisitionId"],
                    properties: { acquisitionId: { type: "string" } },
                    additionalProperties: false,
                  }),
                },
                { key: "read.document", intent: "Read", needs: "document" },
              ],
            },
            target: { session, document: null },
          };
        effects.push({ key, session, openId, id });
        expect(
          JSON.parse(await readFile(f.journalPath, "utf8")).actions.some((row: any) =>
            row.steps.some((step: any) => step.id === id && step.state === "running"),
          ),
        ).toBe(true);
        await held;
        if (fail) throw new BridgeError("lost native response", 503);
        return {
          value: { status: "acquired", openId: "created" },
          target: { session, document: null },
        };
      }),
  } as unknown as RevitBridge["Service"];
  let web = router(f.owner, bridge);
  const work = new RouteWorkspace({
    registrations: [{ spec: takeoffsRouteState, handlers: {} }],
    store: {
      getState: ({ route, targetKey }) =>
        f.state.getState({ threadId: "resource-work", type: `${route}:${targetKey}` }),
      setState: ({ route, targetKey, value }) =>
        f.state.setState({ threadId: "resource-work", type: `${route}:${targetKey}`, value }),
    },
  });
  const scope = { route: "takeoffs", target: at };
  expect(await work.read(scope, "takeoffs")).toBeNull();
  expect(await work.apply(scope, "takeoffs", "human", [], 0)).toMatchObject({
    ok: true,
    revision: 1,
  });
  try {
    expect((await web.call("/actions", admission("original-id"))).status).toBe(202);
    await vi.waitFor(() => expect(effects).toHaveLength(1));
    const before = (await work.read(scope, "takeoffs"))!;
    const staged = [{ roomId: "r", base: { name: "old" }, next: { name: "edited while running" } }];
    expect(
      await work.apply(
        scope,
        "takeoffs",
        "human",
        [{ path: ["staged"], value: staged }],
        before.revision,
      ),
    ).toMatchObject({ ok: true, revision: before.revision + 1 });
    expect((await web.call("/actions", admission("original-id"))).status).toBe(202);
    expect(
      (
        await web.call("/actions", {
          ...admission("original-id"),
          input: { acquisitionId: "changed" },
        })
      ).status,
    ).toBe(409);
    release();
    expect((await f.owner.wait("original-id")).state).toBe("succeeded");
    expect(effects).toEqual([
      { key: "family.temporary.acquire", session: "B", openId: null, id: expect.any(String) },
    ]);
    expect((await work.read(scope, "takeoffs"))!.doc).toMatchObject({ staged });
    await web.close();
    const reconstructed = new ActionJournal(f.journalPath, f.census);
    web = router(reconstructed, {
      ...bridge,
      list: Effect.fail(Error("no bridge after reconstruction")),
    } as never);
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      web.call(
        new URL(url).pathname + new URL(url).search,
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      ),
    );
    expect(await submitAction(admission("original-id"), "http://host")).toMatchObject({
      state: "succeeded",
    });
    await expect(
      submitAction(
        { ...admission("original-id"), input: { acquisitionId: "different" } },
        "http://host",
      ),
    ).rejects.toThrow("conflicts");
    vi.unstubAllGlobals();
    expect(effects).toHaveLength(1);
    await web.close();
    web = router(reconstructed, bridge);
    expect(
      (
        await web.call(
          "/call",
          { key: "read.document" },
          { "x-pe-bridge-session-id": "B", "x-pe-open-document-id": "reopened-wrong" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await web.call(
          "/call",
          { key: "settings.document.save", request: {} },
          { "x-pe-action-id": "bypass", "x-pe-action-actor": "agent" },
        )
      ).status,
    ).toBe(409);
    fail = true;
    await web.call("/actions", admission("uncertain"));
    expect((await reconstructed.wait("uncertain")).state).toBe("unknown");
    expect(
      (
        await web.call("/actions", {
          ...admission("new"),
          destination: { kind: "session", session: "A" },
        })
      ).status,
    ).toBe(409);
    expect(effects).toHaveLength(2);
  } finally {
    release();
    await web.close();
    await f.close();
  }
}, 15000);

test("finite configured DB census archives every resource's uncertainty; restart and reads cannot clear it; missing input fails closed", async () => {
  const f = await setup();
  const legacy = {
    version: 1,
    revision: 4,
    doc: { proposal: "keep" },
    inFlight: { command: "execute", startedAt: "then" },
  };
  try {
    await f.state.setState({ threadId: "old-resource", type: "pods:old-scope", value: legacy });
    await f.state.setState({
      threadId: "different-resource",
      type: "pods:another-scope",
      value: {
        ...legacy,
        inFlight: undefined,
        outcomeUnknown: { command: "run", startedAt: "before" },
      },
    });
    await f.state.setState({ threadId: "ordinary", type: "task", value: { text: "unrelated" } });
    const source = await f.census();
    expect(source.rows).toHaveLength(3);
    const execute = vi.fn();
    await expect(f.owner.admit(admission("new"), async () => ({}), execute)).rejects.toThrow(
      "Legacy external outcome remains unknown",
    );
    const archived = await f.owner.legacyStatus();
    expect(archived.sources[0]?.rowCount).toBe(3);
    expect(archived.unresolved).toHaveLength(2);
    expect(JSON.parse(archived.unresolved[0]!.value)).toHaveProperty("doc.proposal", "keep");
    expect(
      archived.unresolved.every((row) => row.outcome === "unknown" && row.domain === "unproven"),
    ).toBe(true);
    await f.state.deleteState({ threadId: "old-resource", type: "pods:old-scope" });
    const restored = new ActionJournal(f.journalPath, f.census);
    await restored.importLegacy();
    expect((await restored.legacyStatus()).unresolved).toHaveLength(2);
    await expect(restored.admit(admission("another"), async () => ({}), execute)).rejects.toThrow(
      "unknown",
    );
    expect(execute).not.toHaveBeenCalled();
    const { createRouteRegistrations } = await import("../../../packages/mcps/src/pea/routes.ts");
    const registrations = createRouteRegistrations({ hostBaseUrl: "http://unused" });
    expect(registrations.some(({ spec }) => spec.route === "pods" || spec.route === "ops")).toBe(
      false,
    );
    const work = new RouteWorkspace({
      registrations,
      store: {
        getState: ({ targetKey, route }) =>
          f.state.getState({ threadId: "authored", type: `${route}:${targetKey}` }),
        setState: async ({ targetKey, route, value }) => {
          await f.state.setState({ threadId: "authored", type: `${route}:${targetKey}`, value });
        },
      },
    });
    const scope = { route: "takeoffs", target: at };
    const reading = await work.read(scope, "takeoffs");
    expect(
      await work.apply(
        scope,
        "takeoffs",
        "human",
        [{ path: ["staged"], value: [] }],
        reading?.revision ?? 0,
      ),
    ).toMatchObject({ ok: true });
    expect((await restored.legacyStatus()).unresolved).toHaveLength(2);
    expect(
      await f.state.getState({ threadId: "different-resource", type: "pods:another-scope" }),
    ).toHaveProperty("doc.proposal", "keep");
    const unavailable = new ActionJournal(f.journalPath, () => readLegacyRouteState({} as never));
    await expect(unavailable.importLegacy()).rejects.toThrow("known configured local file");
    expect((await restored.legacyStatus()).unresolved).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 15000);

test.each(["outcome-unknown", "failed", "recovery-required"])(
  "HTTP leaf %s is never a successful effect or resumable completion",
  async (status) => {
    const directory = await mkdtemp(join(tmpdir(), "gateway-outcome-"));
    const path = join(directory, "journal.json");
    const owner = new ActionJournal(path);
    let effects = 0;
    const bridge = {
      list: Effect.succeed([
        {
          sessionId: "B",
          processId: 42,
          processStartUtcUnixMs: 1000,
          state: { openDocuments: [] },
        },
      ]),
      invoke: (key: string) =>
        Effect.succeed(
          key === "host.ops.catalog"
            ? {
                value: {
                  operations: [
                    {
                      key: "family.temporary.acquire",
                      intent: "Mutate",
                      needs: "nothing",
                      requestSchemaJson: '{"type":"object"}',
                    },
                  ],
                },
              }
            : (effects++,
              {
                value: {
                  acquisitionId: "leaf",
                  status,
                  recoveryId: "temporary-leaf",
                  document: null,
                },
              }),
        ),
    } as unknown as RevitBridge["Service"];
    let nativeEvidence: unknown;
    let originalStepId = "";
    const sdk: SdkReceiptReader = async (args) => {
      if (args[0] !== "op") return sdkSessions();
      expect(args).toEqual(
        nativeReceiptArgs(originalStepId, originalProcess, "family.temporary.acquire"),
      );
      return sdkEnvelope(nativeEvidence);
    };
    const web = router(owner, bridge, sdk);

    try {
      expect((await web.call("/actions", admission("leaf"))).status).toBe(202);
      expect(await owner.wait("leaf")).toMatchObject({
        state: "unknown",
        steps: [{ state: "unknown", evidence: { result: { status, acquisitionId: "leaf" } } }],
      });
      const restored = new ActionJournal(path);
      expect((await restored.list(undefined, "leaf"))[0]?.state).toBe("unknown");
      expect((await web.call("/actions", admission("new-leaf"))).status).toBe(409);
      expect((await web.call("/actions/resume", admission("leaf"))).status).toBe(409);
      expect(effects).toBe(1);
      originalStepId = (await restored.list())[0]!.steps[0]!.id;
      nativeEvidence = {
        state: "completed",
        requestId: originalStepId,
        receipt: {
          ...originalProcess,
          requestId: originalStepId,
          key: "family.temporary.acquire",
          verdict: "ok",
        },
        response: { acquisitionId: "leaf", status, recoveryId: "temporary-leaf", document: null },
      };
      expect(await (await web.call("/actions/recover", { id: "leaf" })).json()).toMatchObject({
        state: "unknown",
        steps: [{ id: originalStepId, state: "unknown", evidence: { result: { status } } }],
      });
      if (status === "outcome-unknown") {
        nativeEvidence = {
          state: "completed",
          requestId: originalStepId,
          receipt: {
            ...originalProcess,
            requestId: originalStepId,
            key: "family.temporary.acquire",
            verdict: "failed",
          },
          response: {
            error: "queue refused before dispatch",
            statusCode: 423,
            outcome: "RefusedQueueUnresponsive",
          },
        };
        expect(await (await web.call("/actions/recover", { id: "leaf" })).json()).toMatchObject({
          state: "failed",
          notDispatched: true,
          steps: [{ id: originalStepId, state: "failed", notDispatched: true }],
        });
        expect(effects).toBe(1);
      }
    } finally {
      await web.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);

test("host-only shell uses real file validation and owning HTTP journal; exact body replay needs no bridge or catalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-shell-"));
  const file = join(dir, "review.txt");
  await writeFile(file, "saved review");
  const path = join(dir, "journal.json");
  let owner = new ActionJournal(path);
  const launch = vi.fn(async () => {});
  const bridge = {
    list: Effect.die("host action must not read Revit"),
    invoke: () => Effect.die("host action must not dispatch Revit"),
  } as unknown as RevitBridge["Service"];
  const serve = () =>
    HttpRouter.toWebHandler(
      makeCallRoute(owner, undefined, { launchShell: launch }).pipe(
        Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
      ),
      { disableLogger: true },
    );
  let web = serve();
  const body = {
    id: "open-review",
    key: "host.shell.open",
    kind: "operation" as const,
    actor: "human" as const,
    destination: { kind: "host" as const },
    input: { path: file },
    bases: {},
  };
  let loseAcceptance = true;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const response = await web.handler(new Request(url, init), Context.empty() as never);
    if (init?.method === "POST" && loseAcceptance) {
      loseAcceptance = false;
      throw Error("lost acceptance response");
    }
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(await submitAction(body, "http://host")).toMatchObject({
      state: "succeeded",
      result: { opened: true },
    });
    await web.dispose();
    owner = new ActionJournal(path);
    web = serve();
    expect(await submitAction(body, "http://host")).toMatchObject({ state: "succeeded" });
    expect(launch).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.every(([url]) => new URL(url).pathname === "/actions")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test("forwarded recovery and resume refuse without touching another host", async () => {
  vi.stubEnv("PE_TOOLS_CALL_FORWARD", "http://foreign");
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const dir = await mkdtemp(join(tmpdir(), "gateway-forward-"));
  const web = router(new ActionJournal(join(dir, "journal.json")), {} as never);
  try {
    for (const choice of ["recover", "resume"])
      expect((await web.call(`/actions/${choice}`, { id: "original" })).status).toBe(409);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await web.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real bridge session reads omit document and queued exact document cannot dispatch after reopen", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
        const web = HttpRouter.toWebHandler(
          makeCallRoute().pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
          { disableLogger: true },
        );
        const response = (id: string, value: unknown) =>
          Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Response",
              response: {
                requestId: id,
                ok: true,
                statusCode: 200,
                payloadJson: JSON.stringify(value),
                metrics: {
                  requestBytes: 0,
                  responseBytes: 0,
                  revitExecutionMs: 0,
                  roundTripMs: 0,
                  serializationMs: 0,
                },
              },
            }),
          );
        try {
          const request = web.handler(
            new Request("http://host/call", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-pe-bridge-session-id": target.session,
                "x-pe-open-document-id": "must-not-leak",
              },
              body: JSON.stringify({ key: "read.session", request: {} }),
            }),
            Context.empty() as never,
          );
          const catalog = yield* Queue.take(outgoing);
          expect(catalog.request?.operationKey).toBe("host.ops.catalog");
          expect(catalog.request?.openDocumentId).toBeUndefined();
          yield* response(catalog.request!.requestId, {
            operations: [{ key: "read.session", intent: "Read", needs: "nothing" }],
          });
          const read = yield* Queue.take(outgoing);
          expect(read.request?.openDocumentId).toBeUndefined();
          yield* response(read.request!.requestId, { read: true });
          expect((yield* Effect.promise(() => request)).status).toBe(200);
          const held = yield* Effect.forkScoped(
            bridge.invoke("held", {}, target.session, target.openId),
          );
          const heldFrame = yield* Queue.take(outgoing);
          const queued = yield* Effect.forkScoped(
            Effect.result(bridge.invoke("exact.read", {}, target.session, target.openId)),
          );
          yield* Effect.yieldNow;
          expect(yield* Queue.size(outgoing)).toBe(0);
          const current = (yield* bridge.list)[0]!.state!;
          yield* Queue.offer(
            incoming,
            JSON.stringify({
              kind: "StateSync",
              stateSync: {
                state: {
                  ...current,
                  openDocuments: current.openDocuments.map((doc) =>
                    doc.openId === target.openId ? { ...doc, openId: "reopened" } : doc,
                  ),
                },
              },
            }),
          );
          yield* Effect.promise(() =>
            vi.waitFor(async () =>
              expect(
                (await Effect.runPromise(bridge.list))[0]?.state?.openDocuments[0]?.openId,
              ).toBe("reopened"),
            ),
          );
          yield* response(heldFrame.request!.requestId, {});
          yield* Fiber.join(held);
          const result = yield* Fiber.join(queued);
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { evidence: { notDispatched: true } },
          });
          expect(yield* Queue.size(outgoing)).toBe(0);
        } finally {
          yield* Effect.promise(() => web.dispose());
        }
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  );
}, 15000);

test("failed legacy import preserves raw Work on reads and authored writes; reconstruction still blocks mutation", async () => {
  const f = await setup();
  const scope = { route: "takeoffs", target: at };
  const raw = {
    version: 1,
    revision: 0,
    doc: { staged: [], bindings: { r10: { id: "C:/old.r10" } }, snapshot: { original: true } },
    inFlight: { command: "script", startedAt: "then" },
  };
  await f.state.setState({ threadId: "old", type: "takeoffs:old", value: raw });
  await mkdir(`${f.journalPath}.tmp`);
  const create = (owner: ActionJournal) =>
    new RouteWorkspace({
      registrations: [
        {
          spec: takeoffsRouteState,
          handlers: {},
          migrate: async (value) => {
            await owner.importLegacy();
            return { ...(value as object), doc: { staged: (value as typeof raw).doc.staged } };
          },
        },
      ],
      store: {
        getState: () => f.state.getState({ threadId: "old", type: "takeoffs:old" }),
        setState: ({ value }) => f.state.setState({ threadId: "old", type: "takeoffs:old", value }),
      },
    });
  try {
    const work = create(f.owner);
    expect(await work.read(scope, "takeoffs")).toMatchObject({
      revision: 0,
      status: "outcomeUnknown",
      migrationError: expect.any(String),
    });
    expect(await f.state.getState({ threadId: "old", type: "takeoffs:old" })).toEqual(raw);
    expect(
      await work.apply(
        scope,
        "takeoffs",
        "human",
        [
          {
            path: ["staged"],
            value: [{ roomId: "r", base: { name: "old" }, next: { name: "authored" } }],
          },
        ],
        0,
      ),
    ).toMatchObject({ ok: true, revision: 1 });
    expect(await f.state.getState({ threadId: "old", type: "takeoffs:old" })).toMatchObject({
      doc: { bindings: raw.doc.bindings, snapshot: raw.doc.snapshot },
      inFlight: raw.inFlight,
    });
    expect((await f.owner.legacyStatus()).unresolved).toEqual([]);
    await rm(`${f.journalPath}.tmp`, { recursive: true });
    const restored = new ActionJournal(f.journalPath, f.census);
    await expect(
      restored.admit(
        admission("new"),
        async () => ({}),
        async () => "must not run",
      ),
    ).rejects.toThrow("unknown");
    expect((await restored.legacyStatus()).unresolved).toHaveLength(1);
    expect(await create(restored).read(scope, "takeoffs")).toMatchObject({
      revision: 1,
      doc: { staged: [{ next: { name: "authored" } }] },
    });
  } finally {
    await f.close();
  }
}, 15000);

test("durable large action results replay; unserializable effect results remain unknown without redispatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "journal-results-"));
  let calls = 0;
  try {
    for (const [name, value] of [
      ["large", "x".repeat(8193)],
      [
        "circular",
        (() => {
          const v: any = {};
          v.self = v;
          return v;
        })(),
      ],
    ] as const) {
      const path = join(dir, `${name}.json`);
      const owner = new ActionJournal(path);
      await owner.admit(
        admission(name),
        async () => ({}),
        async (exec) =>
          exec.step("native", "effect", {}, async () => {
            calls++;
            return value;
          }),
      );
      const row = await owner.wait(name);
      expect(row.state).toBe(name === "large" ? "succeeded" : "unknown");
      const restored = new ActionJournal(path);
      expect(
        await restored.admit(
          admission(name),
          async () => {
            throw Error("fresh validation");
          },
          async () => {
            throw Error("duplicate");
          },
        ),
      ).toEqual(row);
    }
    expect(calls).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
import { HostRpcCaller } from "../../../packages/mcps/src/shared/host-rpc-caller.ts";

test("generic operation client and real router preserve partial payload, replay lost acceptance without catalog/session, distinguish workflow kind and refuse reopened lifetime", async () => {
  const f = await setup();
  let present = true;
  let openId = "original";
  let lost = true;
  let unknown = false;
  let calls = 0;
  const value = {
    applied: 0,
    dryRun: false,
    results: [
      { index: 0, ok: false, message: "whole-call refusal" },
      { index: 900, ok: false, message: "transaction diagnostic" },
    ],
  };
  const bridge = {
    list: Effect.sync(() =>
      present
        ? [
            {
              sessionId: "B",
              processId: 42,
              processStartUtcUnixMs: 1000,
              state: { openDocuments: [{ openId, address: at, isFamilyDocument: false }] },
            },
          ]
        : [],
    ),
    invoke: (key: string, _input: unknown, session?: string, doc?: string) => {
      if (key === "host.ops.catalog")
        return Effect.succeed({
          value: {
            operations: [
              sourceCatalog.find((row) => row.key === "revit.apply.parameter-values")!,
              {
                key: "takeoffs.partition",
                intent: "Mutate",
                needs: "document",
                requestSchemaJson: '{"type":"object"}',
              },
            ],
          },
        });
      calls++;
      expect([session, doc]).toEqual(["B", "original"]);
      return unknown
        ? Effect.fail(new BridgeError("native response lost", 503))
        : Effect.succeed({ value });
    },
  } as unknown as RevitBridge["Service"];
  const web = router(f.owner, bridge);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path === "/ops")
      return Response.json({
        operations: present
          ? ["revit.apply.parameter-values", "takeoffs.partition"].map((key) => ({
              key,
              intent: "Mutate",
              needs: "document",
            }))
          : [],
      });
    const response = await web.call(
      path,
      init?.body ? JSON.parse(String(init.body)) : undefined,
      init?.headers as Record<string, string>,
    );
    if (path === "/actions" && init?.method === "POST" && lost) {
      lost = false;
      throw Error("lost acceptance");
    }
    return response;
  });
  const options = {
    hostBaseUrl: "http://host",
    actor: "agent" as const,
    bridgeSessionId: "B",
    openDocumentId: "original",
    requestId: "raw-parameter",
  };
  try {
    const caller = new HostRpcCaller(options);
    const result = await caller.callOperation("revit.apply.parameter-values", {
      edits: [{ elementId: 1, parameterName: "Mark", value: "sealed" }],
    });
    expect(result).toMatchObject({
      ok: true,
      response: value,
      action: { kind: "operation", publication: { state: "unrequested" } },
    });
    expect(calls).toBe(1);
    present = false;
    expect(
      await new HostRpcCaller(options).callOperation("revit.apply.parameter-values", {
        edits: [{ elementId: 1, parameterName: "Mark", value: "sealed" }],
      }),
    ).toMatchObject({ ok: true, response: value });
    await expect(
      caller.callOperation("revit.apply.parameter-values", {
        edits: [{ elementId: 1, parameterName: "Mark", value: "conflicting" }],
      }),
    ).rejects.toThrow("conflicts");
    expect(calls).toBe(1);
    present = true;
    const raw = {
      ...admission("overlap"),
      key: "takeoffs.partition",
      destination: { kind: "document", ref: { session: "B", openId: "original" } },
      input: {},
    };
    expect((await web.call("/actions", raw)).status).toBe(202);
    expect((await f.owner.wait("overlap")).kind).toBe("operation");
    expect((await web.call("/actions", { ...raw, kind: "workflow" })).status).toBe(409);
    expect(
      (await web.call("/actions", { ...raw, id: "workflow-invalid", kind: "workflow" })).status,
    ).toBe(409);
    openId = "reopened";
    const refused = await web.call("/actions", { ...raw, id: "reopened" });
    expect(refused.status).toBe(202);
    expect(await f.owner.wait("reopened")).toMatchObject({ state: "failed", notDispatched: true });
    openId = "original";
    unknown = true;
    const uncertain = new HostRpcCaller({ ...options, requestId: "uncertain" });
    expect(
      await uncertain.callOperation("revit.apply.parameter-values", { edits: [] }),
    ).toMatchObject({
      ok: false,
      action: { state: "unknown" },
    });
    const count = calls;
    present = false;
    expect(
      await uncertain.callOperation("revit.apply.parameter-values", { edits: [] }),
    ).toMatchObject({
      ok: false,
      action: { state: "unknown" },
    });
    expect(calls).toBe(count);
  } finally {
    vi.unstubAllGlobals();
    await web.close();
    await f.close();
  }
}, 15000);

test("kind migration archives exact legacy bytes and blocks ambiguous old admissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kind-migration-"));
  const journalPath = join(directory, "journal.json");
  try {
    const old = JSON.stringify([
      { id: "ambiguous", key: "new.operation", request: { source: "retained" }, state: "unknown" },
    ]);
    await writeFile(journalPath, old);
    const owner = new ActionJournal(journalPath);
    expect(await owner.list()).toEqual([]);
    expect(await readFile(`${journalPath}.before-kind-v3.json`, "utf8")).toBe(old);
    expect((await owner.legacyStatus()).unresolved[0]).toMatchObject({ outcome: "unknown" });
    await expect(
      owner.admit(
        admission("new"),
        async () => ({}),
        async () => 1,
      ),
    ).rejects.toThrow("Legacy external outcome remains unknown");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { productUserContentRootPath } from "../src/product-paths.ts";

test.each(["utf8", "utf16le", "utf16be", "utf32le", "utf32be"])(
  "real generic script admission seals original Pod bytes and replays after deletion (%s)",
  async (encoding) => {
    const directory = await mkdtemp(join(tmpdir(), "script-source-"));
    const journalPath = join(directory, "journal.json");
    const f = {
      directory,
      journalPath,
      owner: new ActionJournal(journalPath),
      close: () => rm(directory, { recursive: true, force: true }),
    };
    const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
    process.env.PE_TOOLS_DOCUMENTS_ROOT = f.directory;
    const workspace = join(productUserContentRootPath(), "workspaces", "sample");
    await mkdir(join(workspace, "src"), { recursive: true });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: "sample",
      name: "Sample",
      version: "1.0.0",
      entrypoints: [{ id: "main", sourcePath: "src/Main.cs" }],
    });
    let manifestBytes: Buffer;
    if (encoding.startsWith("utf32")) {
      const codes = [0xfeff, ...Array.from(manifest, (c) => c.codePointAt(0)!)];
      manifestBytes = Buffer.alloc(codes.length * 4);
      codes.forEach((code, index) =>
        encoding === "utf32le"
          ? manifestBytes.writeUInt32LE(code, index * 4)
          : manifestBytes.writeUInt32BE(code, index * 4),
      );
    } else if (encoding.startsWith("utf16")) {
      manifestBytes = Buffer.from("\ufeff" + manifest, "utf16le");
      if (encoding === "utf16be") manifestBytes.swap16();
    } else manifestBytes = Buffer.from(manifest);
    await writeFile(join(workspace, "pod.json"), manifestBytes);
    const projectSeed =
      '<Project><ItemGroup><Reference Include="Local"><HintPath>lib/$(RevitYear)/Local.dll</HintPath></Reference></ItemGroup></Project>';
    if (encoding !== "utf8") await writeFile(join(workspace, "PeScripts.csproj"), projectSeed);
    await writeFile(
      join(workspace, "src", "Main.cs"),
      "public static class Main { public static int Run() => Helper.Value; }",
    );
    await writeFile(
      join(workspace, "src", "Helper.cs"),
      "public static class Helper { public const int Value = 42; }",
    );
    const definition = sourceCatalog.find((row) => row.key === "scripting.execute")!;
    const schema = JSON.parse(definition.requestSchemaJson);
    delete schema.$schema;
    const validate = new Ajv({ strict: false }).compile(schema);
    let calls = 0;
    let present = true;
    let supportsBundle = true;
    const oldSchema = structuredClone(schema);
    delete oldSchema.properties.sourceBundle;
    const bridge = {
      list: Effect.sync(() =>
        present
          ? [
              {
                sessionId: "B",
                processId: 42,
                processStartUtcUnixMs: 1000,
                state: {
                  openDocuments: [{ openId: "original", address: at, isFamilyDocument: false }],
                },
              },
            ]
          : [],
      ),
      invoke: (
        key: string,
        input: any,
        session: string,
        openId: string | null,
        requestId: string,
      ) =>
        Effect.promise(async () => {
          if (key === "host.ops.catalog")
            return {
              value: {
                operations: present
                  ? [
                      supportsBundle
                        ? definition
                        : { ...definition, requestSchemaJson: JSON.stringify(oldSchema) },
                    ]
                  : [],
              },
            };
          calls++;
          expect([session, openId]).toEqual(["B", "original"]);
          const sealed = await readFile(f.journalPath, "utf8");
          expect(sealed).toContain('"ready"');
          expect(sealed).toContain(requestId);
          await writeFile(join(workspace, "src", "Main.cs"), "later syntax error");
          await rm(join(workspace, "src", "Helper.cs"));
          await writeFile(join(workspace, "src", "Added.cs"), "unadmitted syntax error");
          await writeFile(join(workspace, "pod.json"), "invalid later manifest");
          await writeFile(join(workspace, "PeScripts.csproj"), "invalid later project");
          expect(input.workspaceKey).toBe("sample");
          expect(input.sourcePath).toBe("src/Main.cs");
          expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
          expect(input.sourceBundle.project).toEqual(
            encoding === "utf8"
              ? { present: false, bytesBase64: null }
              : { present: true, bytesBase64: Buffer.from(projectSeed).toString("base64") },
          );
          expect(input.sourceBundle.sources.map((file: any) => file.path).sort()).toEqual([
            "src/Helper.cs",
            "src/Main.cs",
          ]);
          expect(Buffer.from(input.sourceBundle.manifestBase64, "base64")).toEqual(manifestBytes);
          // The managed proof consumes this actual persisted/dispatched bundle through the production normalizer/compiler.
          if (process.env.PE_SCRIPT_BUNDLE_PROOF)
            await writeFile(process.env.PE_SCRIPT_BUNDLE_PROOF, JSON.stringify(input));
          return {
            value: {
              status: "CompilationFailed",
              diagnostics: [{ message: "native returned failure" }],
            },
          };
        }),
    } as unknown as RevitBridge["Service"];
    const web = router(f.owner, bridge);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/ops")
        return Response.json({ operations: present ? [definition] : [] });
      return web.call(
        parsed.pathname + parsed.search,
        init?.body ? JSON.parse(String(init.body)) : undefined,
        init?.headers as Record<string, string>,
      );
    });
    const options = {
      hostBaseUrl: `http://script-host-${encoding}`,
      actor: "agent" as const,
      bridgeSessionId: "B",
      openDocumentId: "original",
      requestId: "script",
    };
    const input = { workspaceKey: "sample", sourcePath: "src/Main.cs" };
    try {
      if (encoding === "utf8") {
        supportsBundle = false;
        expect(
          await new HostRpcCaller({ ...options, requestId: "old-native" }).callOperation(
            "scripting.execute",
            input,
          ),
        ).toMatchObject({
          ok: false,
          action: {
            state: "failed",
            notDispatched: true,
            error: expect.stringContaining("does not accept the captured Pod bundle"),
          },
        });
        expect(calls).toBe(0);
        supportsBundle = true;
      }
      const result = await new HostRpcCaller(options).callOperation("scripting.execute", input);
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        response: { status: "CompilationFailed" },
        action: { kind: "operation", state: "succeeded", publication: { state: "unrequested" } },
      });
      present = false;
      await rm(workspace, { recursive: true, force: true });
      expect(
        await new HostRpcCaller(options).callOperation("scripting.execute", input),
      ).toMatchObject({ ok: true, response: { status: "CompilationFailed" } });
      vi.stubEnv("PE_TOOLS_HOST_BASE_URL", options.hostBaseUrl);
      expect(
        await peDo.execute!(
          { key: "pod:sample.main", timeoutSeconds: 30 } as never,
          { agent: { toolCallId: "script" } } as never,
        ),
      ).toMatchObject({ ok: true, result: { response: { status: "CompilationFailed" } } });
      expect(calls).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      if (oldRoot === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
      else process.env.PE_TOOLS_DOCUMENTS_ROOT = oldRoot;
      await web.close();
      await f.close();
    }
  },
);

test("crash before source seal retains unprepared identity and refuses recapture on resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "script-unsealed-"));
  const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = directory;
  const workspace = join(productUserContentRootPath(), "workspaces", "sample");
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "pod.json"), "{}");
  await writeFile(join(workspace, "src/Main.cs"), "first");
  const journalPath = join(directory, "original.json");
  const owner = new ActionJournal(journalPath);
  const intent = {
    ...admission("unsealed"),
    key: "scripting.execute",
    input: { workspaceKey: "sample", sourcePath: "src/Main.cs" },
  };
  let captured!: () => void;
  const capturing = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captures = 0;
  const prepare = async () => {
    captures++;
    await freezeScript(intent.input);
    captured();
    await held;
    throw Error("preparation interrupted before durable seal");
  };
  try {
    await owner.admit(intent, prepare, async () => {
      throw Error("must not dispatch");
    });
    await capturing;
    const crashPath = join(directory, "crash.json");
    await writeFile(crashPath, await readFile(journalPath));
    await writeFile(join(workspace, "src/Main.cs"), "changed before seal");
    const restarted = new ActionJournal(crashPath);
    expect(await restarted.admit(intent, prepare, async () => 1)).toMatchObject({
      id: "unsealed",
      state: "unknown",
      preparation: { state: "unprepared" },
    });
    await expect(restarted.admit(intent, prepare, async () => 1, true)).rejects.toThrow(
      "Original consumed values were not frozen",
    );
    expect(captures).toBe(1);
  } finally {
    release();
    await owner.wait("unsealed");
    if (oldRoot === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = oldRoot;
    await rm(directory, { recursive: true, force: true });
  }
});
