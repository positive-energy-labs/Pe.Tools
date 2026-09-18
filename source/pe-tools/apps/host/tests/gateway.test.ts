import { freezeScript } from "../src/operation-script.ts";
import sourceCatalog from "./fixtures/operation-source-catalog.json" with { type: "json" };
import { connectTestBridge } from "./bridge-fixture.ts";
import { submitAction } from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { test, expect, vi } from "vite-plus/test";
import { mkdtemp, mkdir, rm, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Queue, Fiber } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { address, takeoffsRouteState } from "@pe/agent-contracts";
import { createRuntimeLibSqlStorage } from "../../../packages/runtime/src/storage/profiles.ts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge, RevitBridgeLive, BridgeError } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { type SdkReceiptReader } from "../src/native-receipts.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { productUserContentRootPath } from "../src/product-paths.ts";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "gateway-"));
  const database = join(directory, "mastra.db");
  const storage = await createRuntimeLibSqlStorage({ id: "gateway-test", url: `file:${database}` });
  await storage.init();
  const state = (await storage.getStore("threadState"))!;
  const journalPath = join(directory, "journal.json");
  const owner = new ActionJournal(journalPath);
  return {
    directory,
    database,
    storage,
    state,
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
    const reconstructed = new ActionJournal(f.journalPath);
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
          { key: "pod.member.write", request: {} },
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

test("/call refusal preserves the exact target and guides unknown operation discovery", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
        const web = HttpRouter.toWebHandler(
          makeCallRoute().pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
          { disableLogger: true },
        );
        const reply = (requestId: string, response: Record<string, unknown>) =>
          Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Response",
              response: {
                requestId,
                metrics: {
                  requestBytes: 0,
                  responseBytes: 0,
                  revitExecutionMs: 0,
                  roundTripMs: 0,
                  serializationMs: 0,
                },
                ...response,
              },
            }),
          );
        try {
          const pending = web.handler(
            new Request("http://host/call", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-pe-bridge-session-id": target.session,
                "x-pe-open-document-id": target.openId,
              },
              body: JSON.stringify({ key: "missing.operation" }),
            }),
            Context.empty() as never,
          );
          const catalog = yield* Queue.take(outgoing);
          yield* reply(catalog.request!.requestId, {
            ok: true,
            statusCode: 200,
            payloadJson: JSON.stringify({
              operations: [{ key: "missing.operation", intent: "Read", needs: "document" }],
            }),
          });
          const call = yield* Queue.take(outgoing);
          expect(call.request?.openDocumentId).toBe(target.openId);
          yield* reply(call.request!.requestId, {
            ok: false,
            statusCode: 500,
            openDocumentId: target.openId,
            errorMessage: "Unsupported bridge operation 'missing.operation'.",
          });

          const response = yield* Effect.promise(() => pending);
          expect(response.status).toBe(404);
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            kind: "CatalogLookup",
            message: expect.stringContaining("pe_find"),
            resolvedTarget: { session: target.session, document: "C:/model.rvt" },
          });
        } finally {
          yield* Effect.promise(() => web.dispose());
        }
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  );
});

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
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
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

test("crash before source seal retains unprepared identity and refuses recapture on resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "script-unsealed-"));
  const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = directory;
  const workspace = join(productUserContentRootPath(), "Pods", "sample");
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

test("source seal captures the positive pod set and exact dependency bytes once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "script-portable-"));
  const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = directory;
  const workspaces = join(productUserContentRootPath(), "Pods");
  const root = join(workspaces, "sample");
  const dependency = join(workspaces, "library");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "settings"), { recursive: true });
    await mkdir(join(dependency, "settings"), { recursive: true });
    await writeFile(
      join(root, "pod.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: "sample",
        name: "Sample",
        version: "1.0.0",
        entrypoints: [{ id: "main", sourcePath: "src/Main.cs" }],
      }),
    );
    await writeFile(join(root, "src/Main.cs"), "first");
    await writeFile(join(root, "settings/main.settings.json"), '{"value":1}');
    await writeFile(
      join(dependency, "pod.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: "library",
        name: "Library",
        version: "1.0.0",
        entrypoints: [],
      }),
    );
    await writeFile(join(dependency, "settings/base.settings.json"), '{"base":1}');

    const sealed = await freezeScript({ workspaceKey: "sample", sourcePath: "src/Main.cs" });
    await writeFile(join(root, "src/Main.cs"), "changed after seal");

    expect(sealed?.sourceBundle.files.map((file) => file.path)).toEqual([
      "pod.json",
      "settings/main.settings.json",
      "src/Main.cs",
    ]);
    expect(
      Buffer.from(
        sealed!.sourceBundle.files.find((file) => file.path === "src/Main.cs")!.bytesBase64,
        "base64",
      ).toString("utf8"),
    ).toBe("first");
  } finally {
    if (oldRoot === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = oldRoot;
    await rm(directory, { recursive: true, force: true });
  }
});

test("source seal carries only authored pod bytes, never outputs or stray trees", async () => {
  const directory = await mkdtemp(join(tmpdir(), "script-seal-"));
  const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = directory;
  const workspaces = join(productUserContentRootPath(), "Pods");
  const root = join(workspaces, "sample");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "output", "run-1"), { recursive: true });
    await mkdir(join(root, "stray"), { recursive: true });
    await writeFile(
      join(root, "pod.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: "sample",
        name: "Sample",
        version: "1.0.0",
        entrypoints: [{ id: "main", sourcePath: "src/Main.cs" }],
      }),
    );
    await writeFile(join(root, "src/Main.cs"), "source");
    await writeFile(join(root, "output/run-1/receipt.json"), '{"outcome":"Succeeded"}');
    await writeFile(join(root, "stray/notes.json"), "[]");
    await writeFile(join(root, "notes.json"), "{}");
    const outsideLibrary = join(directory, "outside-library");
    await mkdir(outsideLibrary, { recursive: true });
    await writeFile(join(outsideLibrary, "pod.json"), "not json");
    await symlink(outsideLibrary, join(workspaces, "missing-library"), "junction");

    const sealed = await freezeScript({ workspaceKey: "sample", sourcePath: "src/Main.cs" });

    expect(sealed?.sourceBundle.files.map((file) => file.path)).toEqual([
      "pod.json",
      "src/Main.cs",
    ]);
  } finally {
    if (oldRoot === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = oldRoot;
    await rm(directory, { recursive: true, force: true });
  }
});
