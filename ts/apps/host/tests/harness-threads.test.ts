import { markReadings } from "../src/resource-adapters.ts";
import { openRecordingWriter, openRecordingReader, nativeCatalogIdentity } from "../src/native-recording.ts";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { detachedBridge, sessionView, consentService, harnessThreads, testSpawner, settle, testHostInputs, captureStore, journalAt } from "./effect-test.ts";
import { nativeReadRoot } from "../src/app.ts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { RevitBridge } from "../src/bridge.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { createPeClient, servePeRoute } from "@pe/agent-contracts/pe-api";
import { afterAll, afterEach, beforeAll, expect, onTestFinished, test, vi } from "vite-plus/test";
import { HostLog } from "../src/host-log.ts";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HarnessEventLine } from "../src/harness/thread-store.ts";
import type {
  Caller,
  HarnessEvent,
  HarnessThreadBody,
  PluginHookName,
  PluginHooks,
  WorkHandle,
} from "@pe/agent-contracts";
import { HARNESS_EVENT_MAX_BYTES, readingKey, tools, bindWork, stagedDucts, workKey, address as documentAddress } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { human } from "./callers.ts";
import {
  admitCrossing,
  bindControl,
  onRevoke,
  Refused,
  callerOf,
  originOf,
  assertRunAdmission,
} from "../src/control.ts";
import { createProviders } from "../src/harness/providers.ts";
import {
  IDLE_CHILD_MS,
  type HarnessThreads,
  type HarnessThreadsOptions,
} from "../src/harness/threads.ts";
import * as adapter from "../src/harness/adapter.ts";
import { productProvidersPath } from "../src/product-paths.ts";
import { createUpdateReader, type UpdateRunner } from "../src/update-reader.ts";
import type { Envelope } from "@pe/host-contracts/pe-revit-contract";
import { sdkBinary, sdkCommand } from "./sdk-replay.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { createPeRoutes, fileRouteDocumentStore } from "../src/pe-routes.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { buildCapabilities, peFind, peRead } from "@pe/mcps";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
// Process journeys spawn real harness children, so machine load moves their time. Budget is 3x the
// slowest solo run (10.8 s, 2026-11-04); the 15 s default stays for unit files (vite.config.ts:59).
vi.setConfig({ testTimeout: 30_000 });

let root = "";
let previousLocalAppData: string | undefined;
type Host = {
  fetch: (request: Request) => Promise<Response>;
  /** Who every request crosses as: the identity middleware's stand-in. */
  as: Caller;
  launchScheduled: HarnessThreads["Service"]["launchScheduled"];
  heads: HarnessThreads["Service"]["heads"];
  observe: HarnessThreads["Service"]["observe"];
  runs: HarnessThreads["Service"]["runs"];
  log: HostLog;
  close: () => Promise<unknown>;
  consoles: string[];
};
const hosts: Host[] = [];
const mcpServer = () => ({ name: "pea", command: "unused", args: [], env: [] });
/** Threads and providers behind one fetch, as the host's router mounts them. No probe at start. */
const host = async (
  updatePending?: () => boolean,
  prepare?: () => Promise<unknown>,
  openConsole: (command: string, opened: () => void) => Promise<void> = async (_, opened) =>
    opened(),
  pluginHook?: <N extends PluginHookName>(name: N, event: PluginHooks[N]) => Promise<void>,
  extra: Partial<HarnessThreadsOptions> = {},
): Promise<Host> => {
  const consoles: string[] = [];
  const providers = createProviders({
    spawner: testSpawner(),
    shellPath: async () => "C:\\canary-bin;C:\\also",
    probeOnStart: false,
    openConsole: async (command, _env, opened) => {
      consoles.push(command);
      await openConsole(command, opened);
      return { exitCode: 0, commandExitCode: 0, logPath: join(root, "console.log") };
    },
  });
  const log = new HostLog(join(root, ".log", randomUUID()), Date.now);
  const threads = await harnessThreads({
    runs: consentService(),
    log,
    prepare,
    pluginHook,
    updatePending,
    root,
    worldRoot: tmpdir(),
    mcpServer,
    developerInstructions: async () => "KERNEL: You are Pea.",
    providers,
    ...extra,
  });
  const routed: Host = {
    as: human,
    fetch: (request) =>
      withInvocationContext({ caller: routed.as }, () =>
        /^\/pe\/(providers|access)/.test(new URL(request.url).pathname)
          ? providers.fetch(request)
          : threads.fetch(request),
      ),
    launchScheduled: threads.launchScheduled,
    heads: threads.heads,
    observe: threads.observe,
    runs: threads.runs,
    log,
    close: threads.close,
    consoles,
  };
  hosts.push(routed);
  return routed;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-harness-"));
  // Providers and access resolve under this root, never the user's.
  previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
  process.env.PE_HARNESS_ADAPTER_CODEX = process.env.PE_HARNESS_ADAPTER_CLAUDE;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.FAKE_ACP_SHAPE;
  delete process.env.FAKE_ACP_AUTH;
  delete process.env.FAKE_ACP_GATE;
  delete process.env.FAKE_ACP_NATIVE_CURRENT;
  delete process.env.FAKE_ACP_PROMPT;
  vi.useRealTimers();
});
afterAll(async () => {
  await Promise.all(hosts.map((threads) => threads.close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  delete process.env.PE_HARNESS_ADAPTER_CODEX;
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  await rm(root, { recursive: true, force: true });
});

const caller = (threads: Host) => async (method: string, path: string, body?: unknown) => {
  // A client mints one id per prompt; a test that names none sends a fresh one.
  if (path.endsWith("/prompt") && body && typeof body === "object" && !("id" in body))
    body = { id: randomUUID(), ...body };
  const response = await threads.fetch(
    new Request(`http://host${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    }),
  );
  return { status: response.status, json: await response.json().catch(() => null) };
};
/** A request with no body and so no content type, as a browser `fetch(url, { method })` sends. */
const bare = (threads: Host, method: string, path: string) =>
  threads.fetch(new Request(`http://host${path}`, { method }));
const reader = (threads: Host) => async (id: string) =>
  (await caller(threads)("GET", `/pe/threads/${id}`)).json as HarnessThreadBody;
async function until(
  read: (id: string) => Promise<HarnessThreadBody>,
  id: string,
  done: (body: HarnessThreadBody) => boolean,
) {
  for (let i = 0; i < 200; i++) {
    const body = await read(id);
    if (done(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out: ${JSON.stringify(await read(id))}`);
}
const kinds = (events: HarnessEvent[]) =>
  events
    .filter(
      (event, index) =>
        event.kind !== "run_consent" &&
        event.kind !== "starting" &&
        (event.kind !== "session" || events.findIndex((item) => item.kind === "session") === index),
    )
    .map((e) => (e.kind === "update" ? `update:${e.update.sessionUpdate}` : e.kind));

test.each(["claude", "codex"] as const)(
  "%s: canonical Address Work joins find, stage, sealed preview, 60-second consent, journal apply and receipt in one chain",
  async (harness) => {
    const dir = await mkdtemp(join(root, "chain-"));
    const h = await host(),
      call = caller(h),
      read = reader(h);
    const target = { session: "A", openId: "open-A" };
    const address = documentAddress("C:/Models/chain.rvt");
    const key = bindWork("ducts", address, undefined, target);
    const routes = createPeRoutes({
      registrations: [{ spec: tools.ducts.work }, { spec: tools.fans.work }],
      store: fileRouteDocumentStore(join(dir, "work")),
      heads: { observe: () => () => {} },
      navigation: { documents: async () => [{ ...target, address }], threads: async () => [] },
    });
    const snapshot = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const writes: unknown[] = [];
    const equipmentSubject = elementSubject(snapshot.nodes.find((node: { id: number }) => node.id === 14577391)!);
    const invokeFixture = (op: string, input: unknown, _session?: string, _doc?: string | null, requestId?: string) =>
        Effect.promise(async () => {
          let value: unknown;
          if (op.startsWith("ducts.snapshot.")) value = snapshot;
          else if (op === "ducts.tables") value = { folder: "fixture", tables: {}, missing: [], unsupported: {} };
          else if (op === "ducts.apply" || op === "ducts.apply.plan") {
            const preview = op === "ducts.apply.plan";
            await journal.markDispatched(requestId!);
            if (!preview) writes.push(input);
            value = {
              previewOnly: preview,
              counts: { written: preview ? 0 : 1, planned: preview ? 1 : 0, refused: 0, unchanged: 0 },
              writes: [{ kind: "equipment-flow", id: 14577391, outcome: preview ? "planned" : "written" }],
              storeRevision: 1,
              systemsAfter: [],
            };
          } else throw Error(`Unexpected bridge op ${op}`);
          return { value, target: { session: "A", document: address, documentRef: target } };
        });
    const bridge = detachedBridge({
      list: Effect.succeed([
        sessionView({
          sessionId: "A",
          connected: true,
          ...hostOwnership,
          processId: 42,
          processStartUtcUnixMs: 1000,
          state: { openDocuments: [{ ...target, address, isFamilyDocument: false }] },
        }),
      ]),
      invoke: invokeFixture,
      invokeHandle: (key, input, session, openId, requestId) => Effect.gen(function* () {
        const answer = yield* Effect.cached(invokeFixture(key, input, session, openId, requestId).pipe(
          Effect.map(({ value }) => ({
            value,
            nativeRequestId: requestId!,
            actualTarget: { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: openId ? { openId } : { kind: "session-only" as const } },
            freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const },
            cost: {}, outcome: "native-acknowledged" as const,
          })),
        ));
        return { answer, terminal: Effect.as(answer, "native-acknowledged" as const) };
      }),
    });
    const readScope = Scope.makeUnsafe();
    onTestFinished(() => settle(Scope.close(readScope, Exit.void)));
    const readContext = await settle(Layer.buildWithScope(
      Layer.mergeAll(Layer.effect(HostNativeRead, HostNativeRead), testHostInputs).pipe(
        nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
        Layer.provide(Layer.succeed(RevitBridge, bridge)),
      ), readScope,
    ));
    const deps = { sdk: sdkSessions, nativeRead: Context.get(readContext, HostNativeRead), files: Context.get(readContext, DuctFiles), marks: Context.get(readContext, HostDocumentMarks) };
    const resolve = commandRegistry(bridge, captureStore("harness-threads"), deps, () => Effect.fail(Error("No local command in this journey")));
    const journal = journalAt(join(dir, "journal.jsonl"), Date.now);
    journal.bindCommands({
      work: routes.workspace,
      resolve,
      probe: async () => true,
    });
    let base = "";
    let located: WorkHandle;
    const failures: unknown[] = [];
    const server = createServer(async (incoming, outgoing) => {
      try {
        const path = new URL(incoming.url!, base).pathname;
        const resolved = callerOf(
          { kind: "local" },
          { "x-pe-context": String(incoming.headers["x-pe-context"] ?? "") },
        );
        if (!("caller" in resolved)) throw Error("Unrecognized chain caller");
        const result = await withInvocationContext(
          {
            caller: resolved.caller,
            hostBaseUrl: base,
            headers: { "x-pe-context": String(incoming.headers["x-pe-context"] ?? "") },
          },
          async () => {
            if (path === "/pe/scope/self") return Response.json({}, { status: 404 });
            if (path === "/ops") return Response.json({ operations: [] });
            if (path === "/call")
              return Response.json({
                sessions: [
                  { sessionId: "A", connected: true, openDocuments: [{ ...target, address }] },
                ],
              });
            if (path === "/pe/route-state/fans")
              return routes.fetch(new Request(`${base}${incoming.url}`));
            if (path === "/chain/locate") {
              const found = await peRead.execute(
                { key: "route:fans", timeoutSeconds: 30, target: { kind: "open", ref: target } },
                {},
              );
              expect(found).toMatchObject({
                ok: true,
                target: { document: address },
                result: {
                  revision: 1,
                  doc: { equipmentFlows: { [equipmentSubject]: { edit: { value: { cfm: 975 } } } } },
                },
              });
              const census = await routes.workspace.instances();
              expect(census.works).toHaveLength(1);
              expect(census.works[0]).toMatchObject({ scope: { binding: "address" }, revision: 1 });
              expect(workKey(census.works[0]!.scope)).toBe(workKey({ ...key, route: "fans" }));
              located = { key, revision: 0 };
              return Response.json(found);
            }
            if (path === "/pe/capabilities")
              return Response.json({
                at: new Date().toISOString(),
                sources: {},
                diagnostics: [],
                machine: machineFixture(),
                capabilities: buildCapabilities({
                  ops: [],
                  routes: [tools.ducts.work, tools.fans.work],
                  packages: [],
                  skills: [],
                }),
              });
            if (path === "/chain/find")
              return Response.json(await peFind.execute({ query: "ducts", limit: 8 }, {}));
            if (path === "/chain/stage")
              return routes.fetch(
                new Request(
                  `${base}/pe/route-state/fans/apply?target=${encodeURIComponent(address)}`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      kind: "apply",
                      expectedRevision: 0,
                      press: null,
                      patches: [
                        {
                          path: ["equipmentFlows", equipmentSubject],
                          value: { edit: { value: { cfm: 975, source: "chain" } } },
                        },
                        {
                          path: ["writeIntent"],
                          value: {
                            edit: {
                              value: {
                                walk: { unitId: 14577391, portIndex: 2 },
                              },
                            },
                          },
                        },
                      ],
                    }),
                  },
                ),
              );
            const phase = path.endsWith("/preview") ? "preview" : "apply";
            const work = located;
            await journal.invoke(
              {
                id: phase,
                key: `ducts.${phase === "preview" ? "plan" : "apply"}-losses`,
                target: { kind: "document", ref: target },
                input: { work },
              },
              { caller: resolved.caller, basis: null },
            );
            return Response.json(await journal.wait(phase));
          },
        );
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(await result.text());
      } catch (error) {
        failures.push(error);
        outgoing.writeHead(500);
        outgoing.end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    vi.stubEnv("FAKE_ACP_CHAIN", `${base}/chain`);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      bindControl({ runs: h.runs });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      await call("POST", `/pe/threads/${id}/prompt`, { text: `chain ${harness}` });
      const waiting = await untilIo(
        () => read(id),
        (body) => !body.running || openAsks(body).some((ask) => ask.scope === "run"),
      );
      expect(openAsks(waiting), String(failures[0] ?? JSON.stringify(waiting.events))).toHaveLength(1);
      expect(JSON.stringify(waiting.events)).toContain("chain find:");
      const preview = (await journal.list(undefined, "preview"))[0];
      expect(preview).toMatchObject({
        state: "succeeded",
        result: { previewOnly: true, seal: { requestHash: expect.any(String) } },
      });
      expect(writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1_000);
      const done = await untilIo(
        () => read(id),
        (body) => !body.running && turnEnds(body).length === 1,
      );
      expect(JSON.stringify(done.events)).toContain("chain apply:");
      expect(writes).toHaveLength(1);
      expect(await journal.wait("apply")).toMatchObject({
        state: "succeeded",
        consent: { decision: { by: "deadline" } },
        steps: [
          { kind: "native", state: "succeeded", dispatchedAt: expect.any(String) },
          { kind: "publication", state: "succeeded" },
        ],
      });
      const saved = (await routes.workspace.view(key, "ducts"))!.doc as never;
      const fans = fansDocumentSchema.parse((await routes.workspace.view({ ...key, route: "fans" }, "fans"))!.doc);
      expect(stagedDucts(saved, fans).equipmentFlows).toEqual({});
      expect(writes[0]).toMatchObject({ equipmentFlows: [{ id: 14577391, cfm: 975, source: "chain" }] });
    } finally {
      vi.useRealTimers();
      await h.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  30_000,
);

test("automatic update admission refuses a new Pea prompt through download and releases on confirmed refusal", async () => {
  const planId = "64f25f46-dfa6-4ee6-b973-d7f6a8b523c4";
  let release!: () => void;
  const download = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requestId = "";
  let state = "running";
  const receipt = () => ({
    state,
    requestId,
    planId,
    receiptPath: "fixture.receipt.json",
    reopen: [],
    restartYears: [],
    legs: [],
  });
  const answer = (result: unknown): Envelope<unknown> => ({
    result,
    exitCode: state === "running" ? 4 : 3,
    diagnostics: [],
    resolved: null,
    binary: sdkBinary,
    command: sdkCommand,
    nextSteps: [],
    guide: "update",
    related: [],
  });
  const run: UpdateRunner = async (args) => {
    if (args[0] === "update") {
      requestId = args[args.indexOf("--request-id") + 1]!;
      await download;
      return answer(receipt());
    }
    return answer({ requestId, response: { requestId, key: "update.apply", result: receipt() } });
  };
  const updates = createUpdateReader({
    path: join(root, "auto-update.json"),
    run,
    installed: true,
    pid: 123,
  });
  const threads = await host(updates.automaticPending);
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (body) => body.events.some((event) => event.kind === "session"));
  const applying = updates.apply(planId, true);
  try {
    expect(updates.automaticPending()).toBe(true);
    const refused = await call("POST", `/pe/threads/${id}/prompt`, {
      text: "new turn during download",
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain("updating");
    expect((await read(id)).events.some((e) => e.kind === "prompt")).toBe(false);
    release();
    await applying;
    expect(updates.automaticPending()).toBe(true);
    state = "refused";
    await updates.refresh(false);
    expect(updates.automaticPending()).toBe(false);
    expect((await call("POST", `/pe/threads/${id}/prompt`, { text: "after refusal" })).status).toBe(
      200,
    );
    await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
  } finally {
    release();
    await applying;
    await threads.close();
  }
});
const turnEnds = (body: HarnessThreadBody) => body.events.filter((e) => e.kind === "turn_end");
/** The open asks: `permission_request`s with no `permission_resolved`. */
const openAsks = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "permission_request" &&
    !body.events.some((r) => r.kind === "permission_resolved" && r.requestId === e.requestId)
      ? [e]
      : [],
  );
const openQuestions = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "question_request" &&
    !body.events.some((r) => r.kind === "question_resolved" && r.requestId === e.requestId)
      ? [e]
      : [],
  );
/** What the fake echoed for the last prompt: the text the harness actually received. */
const lastEcho = (body: HarnessThreadBody) => {
  const prompt = body.events.findLastIndex((e) => e.kind === "prompt");
  const chunk = body.events
    .slice(prompt)
    .find((e) => e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk");
  return chunk?.kind === "update"
    ? ((chunk.update as { content?: { text?: string } }).content?.text ?? "")
    : "";
};

/** Real pipe progress while only the host's timeout clock is fake. */
async function untilIo<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const end = performance.now() + 5000;
  while (performance.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out: ${JSON.stringify(await read())}`);
}

test("turn children retire while conversation history and model choices survive", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const h = await host(),
    call = caller(h),
    read = reader(h);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (body) => body.models.length > 0);
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/trait`, { id: "effort", value: "high" });
  await call("POST", `/pe/threads/${id}/prompt`, { text: "pid" });
  const before = await until(
    read,
    id,
    (body) => !body.running && turnEnds(body).length === 1 && body.session === "closed",
  );
  expect(before.modelId).toBe("m2");
  await call("POST", `/pe/threads/${id}/prompt`, { text: "after retirement" });
  const after = await until(
    read,
    id,
    (body) => !body.running && turnEnds(body).length === 2 && body.session === "closed",
  );
  expect(after.modelId).toBe("m2");
  expect(after.traits.find((trait) => trait.id === "effort")?.current).toBe("high");
  expect(after.events.slice(0, before.events.length)).toEqual(before.events);
  expect(
    after.events.filter((event) => event.kind === "session" && event.state === "resumed").length,
  ).toBeGreaterThanOrEqual(2);
  await h.close();
});

test("connect, model/trait RPCs, active turns and asks prevent idle reaping", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const gates = await mkdtemp(join(root, "gates-"));
  process.env.FAKE_ACP_GATE = gates;
  await writeFile(join(gates, "connect"), "hold");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const threads = await host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  try {
    await untilIo(async () => existsSync(join(gates, "connect.active")), Boolean);
    await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
    expect((await read(id)).session).toBe("started");
    await rm(join(gates, "connect"));
    await untilIo(
      () => read(id),
      (b) => b.models.length > 0,
    );
    for (const [verb, input] of [
      ["model", { modelId: "m2" }],
      ["trait", { id: "effort", value: "high" }],
    ] as const) {
      await rm(join(gates, "config.active"), { force: true });
      await writeFile(join(gates, "config"), "hold");
      const changed = call("POST", `/pe/threads/${id}/${verb}`, input);
      await untilIo(async () => existsSync(join(gates, "config.active")), Boolean);
      await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
      expect((await read(id)).session).toBe("started");
      await rm(join(gates, "config"));
      expect((await changed).status).toBe(200);
    }
    for (const prompt of ["hang", "question"]) {
      await call("POST", `/pe/threads/${id}/prompt`, { text: prompt });
      await untilIo(
        () => read(id),
        (b) => (prompt === "question" ? openQuestions(b).length > 0 : lastEcho(b) === "echo: hang"),
      );
      await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
      const active = await read(id);
      expect(active.session).toBe("resumed");
      expect(active.running).toBe(true);
      await call("POST", `/pe/threads/${id}/cancel`);
      await untilIo(
        () => read(id),
        (b) => !b.running,
      );
    }
  } finally {
    await rm(gates, { recursive: true, force: true });
    await threads.close();
  }
});

test("a question parks the turn, a fork copies the log, and a lost session re-feeds the transcript", async () => {
  const threads = await host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (b) => b.session === "started" && b.lastSeq === 1);

  // A form question parks the turn; the answer reaches the agent as the form's content.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "question" });
  let body = await until(read, id, (b) => openQuestions(b).length === 1);
  expect(body.running).toBe(true);
  const question = openQuestions(body)[0]!;
  expect(question).toMatchObject({
    message: "Which one?",
    requestedSchema: { required: ["pick"] },
  });
  expect(
    (await call("POST", `/pe/threads/${id}/question`, { requestId: "nope", action: "decline" }))
      .status,
  ).toBe(409);
  await call("POST", `/pe/threads/${id}/question`, {
    requestId: question.requestId,
    action: "accept",
    content: { pick: "b" },
  });
  body = await until(read, id, (b) => turnEnds(b).length === 1);
  expect(kinds(body.events).slice(1)).toEqual([
    "prompt",
    "turn_element_targets",
    "update:agent_message_chunk",
    "question_request",
    "question_resolved",
    "update:agent_message_chunk",
    "turn_end",
  ]);
  expect(body.events.find((e) => e.kind === "question_resolved")).toMatchObject({
    by: "user",
    action: "accept",
    content: { pick: "b" },
  });
  expect(JSON.stringify(body.events)).toContain("answered b");

  // Cancel settles an open question; the agent reads it as cancelled.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "question" });
  await until(read, id, (b) => openQuestions(b).length === 1);
  await call("POST", `/pe/threads/${id}/cancel`);
  body = await until(read, id, (b) => turnEnds(b).length === 2);
  expect(body.events.findLast((e) => e.kind === "question_resolved")).toMatchObject({
    by: "cancel",
  });
  expect(lastEcho(body)).toBe("echo: question");

  // Same harness: the log is copied and the ACP session forked, so the model keeps its context.
  const fork = await call("POST", `/pe/threads/${id}/fork`, {});
  expect(fork.status).toBe(200);
  const forked = await until(read, fork.json.id, (b) => b.session === "forked");
  expect(forked.title).toBe("New thread (fork)");
  expect(forked.events.slice(0, body.events.length)).toEqual(body.events);
  expect(forked.events.at(-1)).toMatchObject({
    kind: "session",
    state: "forked",
    acpSessionId: "fake-session-fork",
  });
  await call("POST", `/pe/threads/${fork.json.id}/prompt`, { text: "hello" });
  const after = await until(read, fork.json.id, (b) => turnEnds(b).length === 3);
  expect(lastEcho(after)).toBe("echo: hello");

  // Another harness: no ACP fork; the first prompt carries the transcript, the record only the words.
  const cross = await call("POST", `/pe/threads/${id}/fork`, {
    providerId: "codex",
    title: "handoff",
  });
  const handoff = await until(read, cross.json.id, (b) => b.session === "detached");
  expect([handoff.harness, handoff.title]).toEqual(["codex", "handoff"]);
  await call("POST", `/pe/threads/${cross.json.id}/prompt`, { text: "go on" });
  const fed = await until(read, cross.json.id, (b) => turnEnds(b).length === 3);
  const echo = lastEcho(fed);
  expect({ echo, kinds: kinds(fed.events).slice(-8) }).toMatchObject({
    echo: expect.stringMatching(/^echo: \[Pea resumed this thread/),
  });
  expect(echo).toContain(
    'User: question\n\nPea: echo: question\n\nPea asked: Which one?\n\nUser answered: {"pick":"b"}\n\nPea: answered b\n\nUser: question\n\nPea: echo: question\n\nPea asked: Which one?\n\nUser did not answer (cancel).',
  );
  expect(echo).toMatch(/\[End of transcript\.\]\n\ngo on$/);
  expect(fed.events.findLast((e) => e.kind === "prompt")).toMatchObject({ text: "go on" });
  await call("POST", `/pe/threads/${cross.json.id}/prompt`, { text: "again" });
  expect(lastEcho(await until(read, cross.json.id, (b) => turnEnds(b).length === 4))).toBe(
    "echo: again",
  );

  // A stored session the harness no longer has: a new session, `detached`, the transcript re-fed.
  await threads.close();
  const metaPath = join(root, id, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as { acpSessionId: string };
  await writeFile(metaPath, JSON.stringify({ ...meta, acpSessionId: "lost" }));
  const second = await host();
  await caller(second)("POST", `/pe/threads/${id}/prompt`, { text: "still there?" });
  const lost = await until(reader(second), id, (b) => turnEnds(b).length === 3);
  expect(lost.events.findLast((e) => e.kind === "session")).toMatchObject({ state: "detached" });
  expect(lastEcho(lost)).toMatch(/^echo: \[Pea resumed this thread/);
  expect(lost.session).toBe("closed");
}, 30_000);

/** Every `NAME=value` line the fake echoed on "env". */
const said = (body: HarnessThreadBody, name: string) =>
  body.events
    .flatMap((e) =>
      e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk"
        ? [(e.update as { content?: { text?: string } }).content?.text ?? ""]
        : [],
    )
    .find((text) => text.startsWith(`${name}=`))
    ?.slice(name.length + 1);

test("subscription children exclude inherited inference credentials without changing the host", async () => {
  const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
  for (const name of names) vi.stubEnv(name, "synthetic-inherited-credential");
  const threads = await host();
  for (const provider of ["claude", "codex"]) {
    const body = await envOf(threads, provider);
    for (const name of names) expect(said(body, name)).toBe("");
  }
  for (const name of names) expect(process.env[name]).toBe("synthetic-inherited-credential");
});

async function envOf(threads: Host, providerId: string) {
  const call = caller(threads);
  const created = await call("POST", "/pe/threads", { providerId });
  expect(created.status).toBe(200);
  await call("POST", `/pe/threads/${created.json.id}/prompt`, { text: "env" });
  return until(reader(threads), created.json.id, (b) => turnEnds(b).length === 1);
}

test("an endpoint provider is checked before save, and every thread carries its provider's env", async () => {
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://inherited.invalid");
  vi.stubEnv("MODEL_PROVIDER", "inherited-provider");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-inherited-key");
  process.env.FAKE_ACP_SHAPE = "config";
  process.env.FAKE_ACP_NATIVE_CURRENT = "gpt-4.1-mini";
  const hits: string[] = [];
  const inferred: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    const send = (status: number, body: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url?.startsWith("/bad/")) return send(503, { error: "auth_unavailable" });
    if (request.url === "/ok/v1/models")
      return send(200, {
        data: [
          { id: "gpt-image-1" },
          { id: "gpt-4.1-mini" },
          { id: "gpt-4.1" },
          { id: "gpt-6.1-sol" },
          { id: "gpt-5.6-sol" },
          { id: "gpt-5.2-codex" },
          { id: "claude-haiku-5-5" },
        ],
      });
    if (request.url === "/ok/v1/responses" || request.url === "/ok/v1/messages") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const model = JSON.parse(body).model;
        inferred.push(model);
        if (model === "gpt-5.2-codex") return send(404, { error: "model_not_found" });
        send(
          200,
          request.url === "/ok/v1/messages"
            ? { content: [{ type: "text", text: "OK" }] }
            : {
                output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
              },
        );
      });
      return;
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const codexKey = "sk-codex-secret-4321";
  const claudeKey = "sk-claude-secret-8765";
  try {
    const threads = await host();
    const call = caller(threads);
    const add = (harness: string, name: string, baseUrl: string, apiKey: string) =>
      call("POST", "/pe/providers", { harness, name, auth: { kind: "endpoint", baseUrl, apiKey } });

    const refused = await add("codex", "Bad", `${origin}/bad/v1`, "sk-bad-0000");
    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({
      step: "endpoint",
      message: "unreachable: Endpoint unreachable or unavailable.",
      failure: {
        kind: "unreachable",
        message: "unreachable: Endpoint unreachable or unavailable.",
        raw: JSON.stringify({ error: "auth_unavailable" }),
      },
    });
    expect((await add("codex", "Ftp", "ftp://x", "sk-x")).json.step).toBe("endpoint");
    expect((await call("GET", "/pe/providers")).json).toHaveLength(2);

    const vps = await add("codex", "VPS", `${origin}/ok/v1`, codexKey);
    expect(vps.status).toBe(200);
    expect(vps.json).toMatchObject({
      id: "codex-vps",
      harness: "codex",
      name: "VPS",
      auth: { kind: "endpoint", baseUrl: `${origin}/ok/v1`, keyLast4: "4321" },
      readiness: { state: "ready" },
    });
    expect(JSON.stringify(vps.json)).not.toContain(codexKey);
    expect(vps.json.models.map((m: { modelId: string }) => m.modelId)).toEqual([
      "gpt-6.1-sol",
      "gpt-5.6-sol",
      "gpt-5.2-codex",
    ]);
    // Claude's base is the origin the Anthropic client appends `/v1/messages` to.
    const gate = await add("claude", "Gate", `${origin}/ok/v1`, claudeKey);
    expect(gate.json).toMatchObject({ id: "claude-gate", auth: { baseUrl: `${origin}/ok` } });
    expect(gate.json.models.map((m: { modelId: string }) => m.modelId)).toEqual([
      "claude-haiku-5-5",
    ]);
    expect(inferred).toEqual(["gpt-6.1-sol", "claude-haiku-5-5"]);
    const explicit = await call("POST", "/pe/providers", {
      harness: "codex",
      name: "Explicit",
      auth: {
        kind: "endpoint",
        baseUrl: `${origin}/ok/v1`,
        apiKey: codexKey,
        modelId: "gpt-5.2-codex",
      },
    });
    expect(explicit.status).toBe(400);
    expect(explicit.json.failure.kind).toBe("model");
    expect(explicit.json.failure.raw).toContain("gpt-5.2-codex");
    expect(explicit.json.failure.raw).toContain("Set Model");
    expect(hits).toEqual(
      expect.arrayContaining([
        "GET /ok/v1/models",
        "POST /ok/v1/responses",
        "POST /ok/v1/messages",
      ]),
    );
    expect((await add("codex", "vps", `${origin}/ok/v1`, codexKey)).status).toBe(409);
    expect((await call("POST", "/pe/providers/codex-vps/open-login")).status).toBe(409);
    expect(JSON.parse(await readFile(productProvidersPath(), "utf8")).providers).toHaveLength(2);

    // The CLI and web select a draft model immediately after creating a thread, while
    // its adapter is still connecting. No readiness poll belongs in either caller.
    for (const [providerId, modelId] of [
      ["codex-vps", "gpt-5.6-sol"],
      ["claude-gate", "claude-haiku-5-5"],
    ]) {
      const created = await call("POST", "/pe/threads", { providerId });
      const selected = await call("POST", `/pe/threads/${created.json.id}/model`, { modelId });
      expect([selected.status, selected.json.modelId]).toEqual([200, modelId]);
      await call("POST", `/pe/threads/${created.json.id}/prompt`, { text: "hang" });
      expect((await call("POST", `/pe/threads/${created.json.id}/model`, { modelId })).status).toBe(
        409,
      );
      await call("DELETE", `/pe/threads/${created.json.id}`);
    }

    // Subscription: the harness's own login, no endpoint env.
    const claudeSub = await envOf(threads, "claude");
    expect([said(claudeSub, "ANTHROPIC_BASE_URL"), said(claudeSub, "CODEX_CONFIG")]).toEqual([
      "",
      "",
    ]);
    const codexSub = await envOf(threads, "codex");
    expect(said(codexSub, "MODEL_PROVIDER")).toBe("");
    expect(JSON.parse(said(codexSub, "CODEX_CONFIG")!)).not.toHaveProperty("model_provider");

    // Endpoint: Codex gets the custom provider, Claude the Anthropic base URL and token.
    const codexEnd = await envOf(threads, "codex-vps");
    expect(said(codexEnd, "OPENAI_API_KEY")).toBe("");
    expect([codexEnd.providerId, codexEnd.providerName]).toEqual(["codex-vps", "VPS"]);
    expect(said(codexEnd, "MODEL_PROVIDER")).toBe("pea_endpoint");
    const config = JSON.parse(said(codexEnd, "CODEX_CONFIG")!);
    expect(config).toMatchObject({
      model_provider: "pea_endpoint",
      model_providers: {
        pea_endpoint: { base_url: `${origin}/ok/v1`, env_key: "PEA_ENDPOINT_API_KEY" },
      },
      developer_instructions: expect.stringMatching(/^KERNEL: You are Pea\./),
    });
    // The child got the key; the record keeps its last four.
    expect(said(codexEnd, "PEA_ENDPOINT_API_KEY")).toBe("…4321");
    expect(codexEnd.modelId).toBe("gpt-6.1-sol");
    expect(codexEnd.models).toEqual(vps.json.models);
    const switchModel = await call("POST", `/pe/threads/${codexEnd.id}/model`, {
      modelId: "gpt-5.6-sol",
    });
    expect(switchModel.status).toBe(200);
    expect(switchModel.json.modelId).toBe("gpt-5.6-sol");
    expect((await reader(threads)(codexEnd.id)).session).toBe("resumed");
    expect(
      (await call("POST", `/pe/threads/${codexEnd.id}/model`, { modelId: "gpt-5.2-codex" })).status,
    ).toBe(400);
    expect((await reader(threads)(codexEnd.id)).modelId).toBe("gpt-5.6-sol");
    expect(
      (await call("POST", `/pe/threads/${codexEnd.id}/model`, { modelId: "gpt-4.1-mini" })).status,
    ).toBe(400);
    const unsupported = await call("POST", "/pe/providers", {
      harness: "codex",
      name: "Unsupported",
      auth: {
        kind: "endpoint",
        baseUrl: `${origin}/ok/v1`,
        apiKey: codexKey,
        modelId: "gpt-4.1-mini",
      },
    });
    expect(unsupported.status).toBe(400);
    expect(unsupported.json.message).toContain("Codex metadata");
    expect(inferred).not.toContain("gpt-4.1-mini");
    const claudeEnd = await envOf(threads, "claude-gate");
    expect(said(claudeEnd, "MODEL_PROVIDER")).toBe("");
    expect(said(claudeEnd, "ANTHROPIC_BASE_URL")).toBe(`${origin}/ok`);
    expect(said(claudeEnd, "ANTHROPIC_AUTH_TOKEN")).toBe("…8765");
    expect(said(claudeEnd, "CODEX_CONFIG")).toBe("");
    expect(claudeEnd.modelId).toBe("claude-haiku-5-5");
    expect(claudeEnd.models).toEqual(gate.json.models);
    await call("POST", `/pe/threads/${claudeEnd.id}/prompt`, { text: "credit-refusal" });
    const failed = await until(
      reader(threads),
      claudeEnd.id,
      (body) => !body.running && body.events.some((event) => event.kind === "error"),
    );
    const refusal = failed.events.findLast((event) => event.kind === "error");
    expect(refusal).toMatchObject({
      message: "billing: Out of credit or billing limit reached.",
      failure: { kind: "billing", raw: expect.stringContaining("credit balance") },
    });
    for (const body of [codexEnd, claudeEnd]) {
      const log = await readFile(join(root, body.id, "events.jsonl"), "utf8");
      expect(log).not.toContain(codexKey);
      expect(log).not.toContain(claudeKey);
      // The line on disk is the typed event, redacted on its value: every line decodes as one.
      for (const line of log.trim().split(/\r?\n/))
        expect(() => Schema.decodeUnknownSync(HarnessEventLine)(line)).not.toThrow();
    }
    // An event whose string field carries a key is written with its last four, and still decodes.
    const echoed = await call("POST", "/pe/threads", { providerId: "codex-vps" });
    await call("POST", `/pe/threads/${echoed.json.id}/prompt`, { text: `leak ${codexKey}` });
    const echoLog = await readFile(join(root, echoed.json.id, "events.jsonl"), "utf8");
    expect(echoLog).not.toContain(codexKey);
    const promptLine = echoLog.split(/\r?\n/).find((line) => line.includes('"kind":"prompt"'))!;
    expect(Schema.decodeUnknownSync(HarnessEventLine)(promptLine)).toMatchObject({
      kind: "prompt",
      text: "leak …4321",
    });

    expect((await call("DELETE", "/pe/providers/codex-vps")).status).toBe(204);
    expect((await call("DELETE", "/pe/providers/claude-gate")).status).toBe(204);
    expect((await call("GET", "/pe/providers")).json).toHaveLength(2);
    expect((await call("POST", "/pe/threads", { providerId: "codex-vps" })).status).toBe(400);
  } finally {
    server.close();
    await rm(productProvidersPath(), { force: true });
  }
  // Every probe child now dies by tree kill (two awaited taskkill.exe runs on win32): 11.6 s -> 47 s
  // measured 2026-11-02. The cost is the Spawner closing a live leader, not this test.
}, 90_000);

test("both harnesses retain journal-safe modes", async () => {
  const threads = await host();
  expect(said(await envOf(threads, "claude"), "MODE")).toBe("default");
  expect(said(await envOf(threads, "codex"), "MODE")).toBe("read-only");
});

// A 1x1 PNG, the same fixture the Mastra-era attachment test used.

/* ── The thread's targets: doors 6, 7 and 8 (ADR 0017, ADR 0021) ─────────────────────── */

const T0 = Date.parse("2026-10-12T12:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();
const yours = { kind: "open", ref: { session: "S1", openId: "A" } } as const;
const theirs = { kind: "open", ref: { session: "S2", openId: "B" } } as const;
const peas = { kind: "open", ref: { session: "P", openId: "copy" } } as const;
/** Pea acquired the copy in Revit "P"; a user document opened there later is not acquired. */
const peaAcquiredCopy = {
  acquired: (ref: { session: string; openId: string }) =>
    ref.session === "P" && ref.openId === "copy" ? "acq-copy" : null,
  acquiredSession: (session: string) => (session === "P" ? "acq-P" : null),
};
const userInPeas = { kind: "open", ref: { session: "P", openId: "B" } } as const;
const peaOf = (thread: string): Caller => ({ kind: "pea", context: `ctx-${thread}`, thread });
const onDoc = (ref: { session: string; openId: string }) => ({ kind: "document", ref }) as const;
const put = (...requests: unknown[]) => requests.map((request) => ({ request }));

test("access-050: fork retains the targets but never inherits a human admission", async () => {
  const threads = await host();
  const call = caller(threads);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id = created.json.id;
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(threads.heads.read(id).targets[0]?.admission).not.toBeNull();
  const forked = await call("POST", `/pe/threads/${id}/fork`, {});
  expect(forked.status).toBe(200);
  expect(threads.heads.read(forked.json.id)).toEqual({
    targets: [{ request: yours, admission: null }],
    revision: 0,
  });
});
const crossing = (caller: Caller, ref: { session: string; openId: string }) => {
  try {
    return admitCrossing(caller, onDoc(ref), "/actions");
  } catch (error) {
    if (error instanceof Refused) return error.refusal.code;
    throw error;
  }
};
afterEach(() =>
  bindControl({
    heads: null,
    acquired: () => null,
    acquiredSession: () => null,
  }),
);

test("door 6: a human adds your open lifetimes with an admission; Pea's own and named targets hold none", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  bindControl(peaAcquiredCopy);
  const call = caller(await host());
  const id = "target-door-6";
  const set = await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(set.status).toBe(200);
  expect(set.json.head).toEqual({
    revision: 1,
    targets: [{ request: yours, admission: { revision: 1, at: at(T0), via: "local" } }],
  });
  // Adding a second document keeps the first one's admission as it was.
  const named = { kind: "named", session: "S1", address: "C:/Models/A.rvt" };
  const both = await call("PUT", `/pe/scope/${id}`, {
    targets: put(yours, named, peas, userInPeas),
    expectedRevision: 1,
  });
  expect(both.json.head.targets.map((t: { admission: unknown }) => t.admission)).toEqual([
    { revision: 1, at: at(T0), via: "local" },
    null,
    null,
    // A user's document inside Pea's Revit is yours: adding it admits it like any other.
    { revision: 2, at: at(T0), via: "local" },
  ]);
  const stale = await call("PUT", `/pe/scope/${id}`, { targets: [], expectedRevision: 1 });
  expect([stale.status, stale.json.why]).toEqual([409, "stale"]);
  const twice = await call("PUT", `/pe/scope/${id}`, {
    targets: put(yours, yours),
    expectedRevision: 2,
  });
  expect(twice.status).toBe(403);
});

test("thread target changes preserve Pea capability and retain revocation for external grants", async () => {
  const h = await host();
  bindControl({ heads: h.heads.read });
  const call = caller(h),
    id = "target-context";
  const retired: string[] = [];
  const release = onRevoke((thread, lifetime) => retired.push(`${thread}:${lifetime.openId}`));
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  expect(crossing(peaOf(id), theirs.ref)).toBeNull();
  await call("PUT", `/pe/scope/${id}`, { targets: [], expectedRevision: 1 });
  expect(retired).toEqual([`${id}:A`]);
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  release();
});

test("Pea context targets are editable defaults and mint no external write admission", async () => {
  const h = await host(),
    call = caller(h),
    id = "context-only";
  h.as = peaOf(id);
  const selected = await call("PUT", "/pe/scope/self", {
    targets: put(yours, theirs),
    expectedRevision: 0,
  });
  expect(selected.status).toBe(200);
  expect(
    selected.json.head.targets.map((target: { admission: unknown }) => target.admission),
  ).toEqual([null, null]);
  expect(
    (await call("PUT", "/pe/scope/foreign", { targets: [], expectedRevision: 0 })).status,
  ).toBe(403);
});

test("Pea cannot create its own independent prompt and target selection grants no write", async () => {
  const h = await host(),
    call = caller(h),
    id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id;
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  h.as = peaOf(id);
  expect((await call("POST", `/pe/threads/${id}/prompt`, { text: "renew me" })).status).toBe(403);
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  expect(() => assertRunAdmission(originOf(peaOf(id)))).toThrow("run.none");
  await h.close();
});

/* ── The prompt inbox: client ids, queue and steer, and wait ─────────────────────────────── */

const story = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "prompt"
      ? [`prompt ${e.text}`]
      : e.kind === "prompt_queued"
        ? [`queued ${e.text}`]
        : e.kind === "prompt_dropped"
          ? [`dropped ${e.by}`]
          : e.kind === "turn_end"
            ? [`end ${e.stopReason}`]
            : [],
  );

test("a prompt id is the turn id: a retry never sends twice, other content under it is refused", async () => {
  const threads = await host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const turnId = randomUUID();
  const first = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "hello" });
  expect(first.json).toMatchObject({ turnId, state: "running" });
  const retry = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "hello" });
  expect([retry.status, retry.json.turnId]).toEqual([200, turnId]);
  const other = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "other" });
  expect(other.status).toBe(409);
  const body = await until(read, id, (b) => turnEnds(b).length === 1 && !b.running);
  expect(story(body)).toEqual(["prompt hello", "end end_turn"]);
  expect(body.events.find((e) => e.kind === "prompt")).toMatchObject({ turnId });
  const unnamed = await threads.fetch(
    new Request(`http://host/pe/threads/${id}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "no id" }),
    }),
  );
  expect(unnamed.status).toBe(400);
});

test("queue order holds under steer: the steer runs next, then the queue in order", async () => {
  const threads = await host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const prompt = (text: string, delivery: "steer" | "queue") =>
    call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text, delivery });
  await prompt("hang", "steer");
  await until(read, id, (b) => lastEcho(b) === "echo: hang");
  expect((await prompt("one", "queue")).json.state).toBe("queued");
  expect((await prompt("two", "queue")).json.state).toBe("queued");
  const steered = await prompt("slow", "steer");
  expect(steered.json.state).toBe("running");
  const body = await until(read, id, (b) => turnEnds(b).length === 4 && !b.running);
  expect(story(body)).toEqual([
    "prompt hang",
    "queued one",
    "queued two",
    "end cancelled",
    "prompt slow",
    "end end_turn",
    "prompt one",
    "end end_turn",
    "prompt two",
    "end end_turn",
  ]);
});

test("a restarted host drops the prompts it had queued, saying so", async () => {
  const first = await host();
  const call = caller(first);
  const read = reader(first);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: "hang" });
  await until(read, id, (b) => lastEcho(b) === "echo: hang");
  const queued = randomUUID();
  await call("POST", `/pe/threads/${id}/prompt`, { id: queued, text: "later", delivery: "queue" });
  await first.close();
  const second = await host();
  const body = await reader(second)(id);
  expect(body.events.at(-1)).toMatchObject({
    kind: "prompt_dropped",
    turnId: queued,
    by: "expired",
  });
  expect((await caller(second)("GET", `/pe/threads/${id}/wait?turn=${queued}`)).json).toEqual({
    turnId: queued,
    state: "dropped",
  });
});

test("declared client and actual harness handler share input, output and refusal contracts", async () => {
  const owner = await host();
  const client = createPeClient("http://host", (url, init) =>
    servePeRoute(new Request(url, init), owner.fetch),
  );
  const thread = await client.call("threads.create", {
    body: { providerId: "claude", title: "contract" },
  });
  const params = { id: thread.id };
  expect((await client.call("thread.get", { params })).title).toBe("contract");
  expect((await client.call("thread.update", { params, body: { title: "renamed" } })).title).toBe(
    "renamed",
  );
  expect((await client.call("scope.get", { params })).revision).toBe(0);
  await expect(
    client.call("thread.question", { params, body: { requestId: "gone", action: "decline" } }),
  ).rejects.toMatchObject({ status: 409, message: "No pending question gone" });
  await client.call("thread.remove", { params });
  await expect(client.call("thread.get", { params })).rejects.toMatchObject({ status: 404 });
});

test("one huge tool result is kept bounded in the record, the log and every reader", async () => {
  const threads = await host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await call("POST", `/pe/threads/${id}/prompt`, { text: "huge" });
  const body = await until(read, id, (b) => turnEnds(b).length === 1);
  const updates = body.events.filter(
    (e): e is Extract<HarnessEvent, { kind: "update" }> =>
      e.kind === "update" && ["t-huge", "t-wide"].includes(String(e.update.toolCallId)),
  );
  expect(updates).toHaveLength(2);
  for (const e of updates) {
    expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(HARNESS_EVENT_MAX_BYTES);
    expect(e.update.truncated).toBeGreaterThan(HARNESS_EVENT_MAX_BYTES);
  }
  // A long string keeps its head; a wide structure keeps the call's identity.
  expect(JSON.stringify(updates[0]!.update)).toContain("characters not kept");
  expect(updates[1]!.update).toMatchObject({ toolCallId: "t-wide", status: "completed" });
  expect((await stat(join(root, id, "events.jsonl"))).size).toBeLessThan(
    4 * HARNESS_EVENT_MAX_BYTES,
  );
  expect(threads.log.read(0).entries.some((e) => e.event.kind === "oversize")).toBe(false);
});

for (const harness of ["claude", "codex"] as const) {
  test.each([undefined, "other", "switch_mode"] as const)(
    `${harness}: an unclassified native approval (%s) cannot authorize an effect`,
    async (kind) => {
      const realOpen = adapter.openAdapter;
      const launched = vi.spyOn(adapter, "openAdapter").mockImplementation((...args) => {
        const createClient = args[3];
        args[3] = (connection) => {
          const client = createClient(connection);
          return {
            ...client,
            requestPermission: (request) =>
              client.requestPermission({ ...request, toolCall: { ...request.toolCall, kind } }),
          };
        };
        return realOpen(...args);
      });
      const h = await host(),
        call = caller(h),
        read = reader(h);
      try {
        const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
        await until(read, id, (body) => body.models.length > 0);
        await call("POST", `/pe/threads/${id}/prompt`, { text: "permission" });
        const body = await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
        expect(openAsks(body)).toHaveLength(0);
        expect(body.events.some((event) => event.kind === "permission_request")).toBe(false);
        expect(
          body.events.some(
            (event) =>
              event.kind === "update" &&
              event.update.sessionUpdate === "tool_call_update" &&
              event.update.status === "failed" &&
              String(event.update.title).includes("host semantic or causal CLI commands"),
          ),
        ).toBe(true);
        expect(
          body.events.some(
            (event) =>
              event.kind === "update" &&
              event.update.sessionUpdate === "agent_message_chunk" &&
              String((event.update.content as { text?: string })?.text).includes("chose no"),
          ),
        ).toBe(true);
      } finally {
        launched.mockRestore();
        await h.close();
      }
    },
  );
  test(`${harness}: delayed invocation and CLI child retain immutable old run across the next turn`, async () => {
    const calls: { token: string; harness: string }[] = [];
    const realOpen = adapter.openAdapter;
    const launched = vi.spyOn(adapter, "openAdapter").mockImplementation((...args) => {
      calls.push({ harness: args[0], token: args[2].PE_CONTEXT ?? "" });
      return realOpen(...args);
    });
    const h = await host(),
      call = caller(h),
      read = reader(h);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      const oldId = randomUUID();
      await call("POST", `/pe/threads/${id}/prompt`, { id: oldId, text: "env" });
      await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
      const minted = calls.map((entry) => ({
        entry,
        resolved: callerOf({ kind: "local" }, { "x-pe-context": entry.token }),
      }));
      const old = minted.find(
        (entry) =>
          "caller" in entry.resolved &&
          entry.resolved.caller.kind === "pea" &&
          entry.resolved.caller.run?.turn === oldId,
      )!;
      expect(old).toBeDefined();
      expect(old.entry.harness).toBe(harness);
      const oldCaller = "caller" in old.resolved ? old.resolved.caller : null;
      expect(oldCaller?.kind).toBe("pea");
      const next = randomUUID();
      const gate = join(root, `cancel-gate-${next}`);
      await mkdir(gate);
      await writeFile(join(gate, "hang"), "hold prompt output");
      vi.stubEnv("FAKE_ACP_GATE", gate);
      await call("POST", `/pe/threads/${id}/prompt`, { id: next, text: "hang" });
      await until(
        read,
        id,
        (body) =>
          body.running &&
          existsSync(join(gate, "hang.active")) &&
          body.events.some(
            (event) =>
              event.kind === "session" &&
              event.seq > body.events.findLast((event) => event.kind === "prompt")!.seq,
          ),
      );
      // This is the exact token a delayed MCP invocation and a background CLI inherited.
      const delayed = callerOf({ kind: "local" }, { "x-pe-context": old.entry.token });
      expect(delayed).toEqual(old.resolved);
      expect(() => assertRunAdmission(originOf(oldCaller!))).toThrow("run.closed");
      const scoped = calls
        .map((entry) => callerOf({ kind: "local" }, { "x-pe-context": entry.token }))
        .find(
          (resolved) =>
            "caller" in resolved &&
            resolved.caller.kind === "pea" &&
            resolved.caller.run?.turn === next,
        );
      expect(
        scoped && "caller" in scoped && scoped.caller.kind === "pea" ? scoped.caller.run : null,
      ).toEqual({ thread: id, turn: next });
      await call("POST", `/pe/threads/${id}/cancel`);
      await until(read, id, () => existsSync(join(gate, "cancel.received")));
      expect((await read(id)).running).toBe(true);
      await rm(join(gate, "hang"));
      await until(read, id, (body) => !body.running);
    } finally {
      launched.mockRestore();
      await h.close();
    }
  }, 15000);
  test(`${harness}: Pea's own MCP tools run without a card (ADR 0027 rule 11)`, async () => {
    const h = await host(),
      call = caller(h),
      read = reader(h);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      await call("POST", `/pe/threads/${id}/prompt`, { text: "permission mcp" });
      const body = await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
      expect(openAsks(body)).toHaveLength(0);
      expect(body.events.some((event) => event.kind === "permission_request")).toBe(false);
      expect(
        body.events.some(
          (event) =>
            event.kind === "update" &&
            event.update.sessionUpdate === "agent_message_chunk" &&
            String((event.update.content as { text?: string })?.text).includes("chose yes"),
        ),
      ).toBe(true);
    } finally {
      await h.close();
    }
  });
  test(`${harness}: a native write approval is refused with the host-command boundary`, async () => {
    const h = await host(),
      call = caller(h),
      read = reader(h);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      await call("POST", `/pe/threads/${id}/prompt`, { text: "permission raw-write" });
      const body = await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
      expect(openAsks(body)).toHaveLength(0);
      expect(
        body.events.some(
          (event) =>
            event.kind === "update" &&
            String(event.update.title).includes("Native unjournaled writes are unsupported"),
        ),
      ).toBe(true);
      expect(
        body.events.some(
          (event) =>
            event.kind === "update" &&
            event.update.sessionUpdate === "agent_message_chunk" &&
            String((event.update.content as { text?: string })?.text).includes("chose no"),
        ),
      ).toBe(true);
    } finally {
      await h.close();
    }
  });
}

test("Codex correlated Pea approval uses recorded identity and still refuses native shell/edit", async () => {
  const h = await host(),
    call = caller(h),
    read = reader(h);
  try {
    const id = (await call("POST", "/pe/threads", { providerId: "codex" })).json.id as string;
    await until(read, id, (body) => body.models.length > 0);
    for (const [index, text] of [
      "permission codex",
      "permission codex shell",
      "permission codex edit",
    ].entries()) {
      await call("POST", `/pe/threads/${id}/prompt`, { text });
      const body = await until(
        read,
        id,
        (body) => !body.running && turnEnds(body).length === index + 1,
      );
      const turn = turnEnds(body).at(-1)!.turnId;
      const events = body.events.filter((event) => "turnId" in event && event.turnId === turn);
      expect(openAsks(body)).toHaveLength(0);
      expect(JSON.stringify(events)).toContain(index === 0 ? "chose yes" : "chose no");
      expect(JSON.stringify(events).includes("Native unjournaled writes are unsupported")).toBe(
        index !== 0,
      );
    }
  } finally {
    await h.close();
  }
});

test("recorded run permission answers survive reconnect and restart without approving an old run", async () => {
  const h = await host(),
    call = caller(h),
    read = reader(h),
    id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string,
    turn = randomUUID();
  await until(read, id, (body) => body.models.length > 0);
  await call("POST", `/pe/threads/${id}/prompt`, { id: turn, text: "hang" });
  await until(read, id, (body) => lastEcho(body) === "echo: hang");
  const run = { thread: id, turn },
    by: Caller = { kind: "pea", context: "host-fixture", thread: id, run, root: run };
  const authorized = h.runs.authorize(originOf(by), "command", [
    { kind: "file", path: "C:/user/result.json" },
  ]);
  const body = await until(read, id, (body) => openAsks(body).some((ask) => ask.scope === "run")),
    ask = openAsks(body).find((ask) => ask.scope === "run")!;
  const first = await call("POST", `/pe/threads/${id}/permission`, {
    requestId: ask.requestId,
    optionId: "allow_now",
  });
  expect(first.status).toBe(200);
  await authorized;
  const repeated = await call("POST", `/pe/threads/${id}/permission`, {
    requestId: ask.requestId,
    optionId: "stop_writes",
  });
  expect(repeated.json.decision).toEqual(first.json.decision);
  await h.close();
  const restarted = await host(),
    again = caller(restarted);
  try {
    const recovered = await again("POST", `/pe/threads/${id}/permission`, {
      requestId: ask.requestId,
      optionId: "allow_now",
    });
    expect(recovered.json.decision).toEqual(first.json.decision);
    expect(() => restarted.runs.assertOpen(originOf(by))).toThrow("run.closed");
    const next = { thread: id, turn: randomUUID() };
    restarted.runs.open(next);
    const allowed = await restarted.runs.authorize(
      originOf({ ...by, run: next, root: next }),
      "next",
      [],
    );
    expect(allowed).toMatchObject({ decision: { id: ask.requestId } });
    restarted.runs.close(next, "completed");
    expect((await again("POST", `/pe/threads/${id}/cancel`)).status).toBe(200);
    expect(() =>
      restarted.runs.checkpoint(originOf({ ...by, run: next, root: next }), allowed),
    ).toThrow("consent.stopped");
    const third = await host();
    try {
      const fresh = { thread: id, turn: randomUUID() };
      third.runs.open(fresh);
      const rejected = third.runs
        .authorize(originOf({ ...by, run: fresh, root: fresh }), "fresh", [])
        .catch((error) => error.message);
      expect(openAsks(await reader(third)(id))).toHaveLength(1);
      third.runs.revoke(id);
      expect(await rejected).toContain("consent.stopped");
    } finally {
      await third.close();
    }
  } finally {
    await restarted.close();
  }
});

test("delegated thread processes carry host-bound root consent and Stop", async () => {
  const tokens: string[] = [];
  const realOpen = adapter.openAdapter;
  const launched = vi.spyOn(adapter, "openAdapter").mockImplementation((...args) => {
    tokens.push(args[2].PE_CONTEXT ?? "");
    return realOpen(...args);
  });
  const h = await host(),
    call = caller(h),
    read = reader(h);
  const minted = (turn: string) => {
    for (const token of tokens) {
      const identity = callerOf({ kind: "local" }, { "x-pe-context": token });
      if (
        "caller" in identity &&
        identity.caller.kind === "pea" &&
        identity.caller.run?.turn === turn
      )
        return identity.caller;
    }
    throw Error("No host-issued run token");
  };
  try {
    const parent = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
    const parentTurn = randomUUID(),
      childTurn = randomUUID();
    await until(read, parent, (body) => body.models.length > 0);
    await call("POST", `/pe/threads/${parent}/prompt`, { id: parentTurn, text: "hang" });
    await until(read, parent, (body) => lastEcho(body) === "echo: hang");
    const parentCaller = minted(parentTurn);
    h.as = parentCaller;
    const child = (await call("POST", "/pe/threads", { providerId: "codex", delegated: true })).json
      .id as string;
    expect(
      (await call("POST", `/pe/threads/${child}/prompt`, { id: childTurn, text: "hang" })).status,
    ).toBe(200);
    await until(read, child, (body) => lastEcho(body) === "echo: hang");
    const childCaller = minted(childTurn);
    expect(childCaller.root).toEqual(parentCaller.run);
    const pending = h.runs.authorize(originOf(childCaller), "child-command", [
      { kind: "file", path: "C:/user/shared.json" },
    ]);
    h.as = human;
    const asking = await until(read, parent, (body) =>
      openAsks(body).some((ask) => ask.scope === "run"),
    );
    const ask = openAsks(asking).find((ask) => ask.scope === "run")!;
    await call("POST", `/pe/threads/${parent}/permission`, {
      requestId: ask.requestId,
      optionId: "allow_now",
    });
    const consent = await pending;
    expect(
      await h.runs.authorize(originOf(parentCaller), "parent-command", [
        { kind: "file", path: "C:/user/other.json" },
      ]),
    ).toEqual(consent);
    await call("POST", `/pe/threads/${parent}/cancel`);
    expect(() => h.runs.checkpoint(originOf(childCaller), consent)).toThrow("consent.stopped");
    await call("POST", `/pe/threads/${child}/cancel`);
  } finally {
    launched.mockRestore();
    await h.close();
  }
}, 15000);

test("restart rejects an open countdown and requires a fresh full window", async () => {
  const first = await host();
  const id = (await caller(first)("POST", "/pe/threads", { providerId: "claude" })).json
    .id as string;
  const run = { thread: id, turn: randomUUID() };
  first.runs.open(run);
  const by: Caller = { kind: "pea", context: "fixture", thread: id, run, root: run };
  const stopped = first.runs
    .authorize(originOf(by), "interrupted", [])
    .catch((error) => error.message);
  const ask = openAsks(await reader(first)(id))[0]!;
  await first.close();
  expect(await stopped).toContain("consent.stopped");
  const second = await host();
  try {
    expect(openAsks(await reader(second)(id))).toHaveLength(0);
    const next = { thread: id, turn: randomUUID() };
    second.runs.open(next);
    const rejected = second.runs
      .authorize(originOf({ ...by, run: next, root: next }), "new", [])
      .catch((error) => error.message);
    const fresh = openAsks(await reader(second)(id))[0]!;
    expect(fresh.requestId).not.toBe(ask.requestId);
    expect(Date.parse(fresh.deadline!) - Date.now()).toBeGreaterThan(59_000);
    second.runs.revoke(id);
    expect(await rejected).toContain("consent.stopped");
  } finally {
    await second.close();
  }
});

test("host shutdown settles a running turn and a queued prompt durably, even when the turn ignores cancel", async () => {
  const h = await host();
  const call = caller(h);
  const read = reader(h);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const running = randomUUID();
  const queued = randomUUID();
  await call("POST", `/pe/threads/${id}/prompt`, { id: running, text: "stubborn" });
  await until(read, id, (b) => lastEcho(b) === "echo: stubborn");
  await call("POST", `/pe/threads/${id}/prompt`, { id: queued, text: "later", delivery: "queue" });
  await h.close(); // the turn awaits a child that ignores cancel: closing must not deadlock
  const durable = (await readFile(join(root, id, "events.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const terminals = (turnId: string) =>
    durable.filter(
      (e) =>
        e.turnId === turnId &&
        (e.kind === "turn_end" || e.kind === "error" || e.kind === "prompt_dropped"),
    );
  expect(terminals(running)).toEqual([
    expect.objectContaining({ kind: "error", message: expect.stringContaining("unknown") }),
  ]);
  expect(terminals(queued)).toEqual([
    expect.objectContaining({ kind: "prompt_dropped", by: "expired" }),
  ]);
}, 30_000);

test("a harness that exits mid-turn writes one terminal: a short sentence, stderr folded as raw detail", async () => {
  const h = await host();
  const call = caller(h);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const turn = randomUUID();
  await call("POST", `/pe/threads/${id}/prompt`, { id: turn, text: "die" });
  await until(reader(h), id, (b) => !b.running && b.events.some((e) => e.kind === "error"));
  await h.close(); // shutdown must not write a second terminal for the dead turn
  const ends = (await readFile(join(root, id, "events.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.turnId === turn && (e.kind === "turn_end" || e.kind === "error"));
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({ kind: "error", message: "The claude harness exited (code 3)." });
  // The 2000-char tail starts mid-line; the raw detail starts at the first whole one.
  expect(ends[0].failure.raw).toMatch(/^\[session\/create\] .*\n[\s\S]*durationMs=79$/);
}, 30_000);

test("Stop with a failing consent persist still cancels, then kills a child that ignores cancel, recording unknown", async () => {
  const consents = consentService();
  let failed = false;
  const runs: typeof consents = {
    ...consents,
    // The first grant-revocation persist fails, as ConsentPersistFailed would.
    close: (ref, reason) =>
      failed ? consents.close(ref, reason) : ((failed = true), Effect.die(Error("persist failed"))),
  };
  const h = await host(undefined, undefined, undefined, undefined, { runs, stopGraceMs: 500 });
  const call = caller(h);
  const read = reader(h);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const turn = randomUUID();
  await call("POST", `/pe/threads/${id}/prompt`, { id: turn, text: "stubborn" });
  await until(read, id, (b) => lastEcho(b) === "echo: stubborn");
  await call("POST", `/pe/threads/${id}/cancel`); // the persist fails; the cancel still goes out
  const body = await until(read, id, (b) => !b.running);
  expect(JSON.stringify(body.events)).toContain("ignoring cancel"); // the child received ACP cancel
  expect(
    body.events.filter(
      (e) => "turnId" in e && e.turnId === turn && (e.kind === "error" || e.kind === "turn_end"),
    ),
  ).toEqual([
    expect.objectContaining({ kind: "error", message: expect.stringContaining("unknown") }),
  ]);
  await h.close();
}, 30_000);

test("question settlement survives a throwing persist listener and reports failure", async () => {
  const h = await host(undefined, undefined, undefined, undefined, {
    receiptFact: (_id, _title, event) => {
      if (event.kind === "question_resolved") throw Error("question persist failed");
    },
  });
  const call = caller(h);
  const read = reader(h);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id: string = created.json.id;
  await call("POST", `/pe/threads/${id}/prompt`, { text: "question" });
  const body = await until(read, id, (b) => openQuestions(b).length === 1);
  const result = await call("POST", `/pe/threads/${id}/question`, {
    requestId: openQuestions(body)[0]!.requestId,
    action: "accept",
    content: { pick: "b" },
  });
  expect(result.status).toBe(502);
  expect(result.json.error).toContain("question persist failed");
  await expect.poll(async () => JSON.stringify((await read(id)).events)).toContain("answered b");
  await until(read, id, (b) => !b.running);
});

test("Stop escalation kills the child even when the transcript disk append fails", async () => {
  let killed = false;
  const h = await host(
    undefined,
    undefined,
    undefined,
    async (name) => {
      if (name === "harness.session.stopped") killed = true;
    },
    { stopGraceMs: 500 },
  );
  const call = caller(h);
  const read = reader(h);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id: string = created.json.id;
  await call("POST", `/pe/threads/${id}/prompt`, { text: "stubborn" });
  await until(read, id, (b) => lastEcho(b) === "echo: stubborn");
  killed = false;
  const append = h.log.append.bind(h.log);
  const fault = vi.spyOn(h.log, "append").mockImplementation((event) => {
    if (
      event.kind === "thread" &&
      event.event.kind === "error" &&
      event.event.message.startsWith("Stop:")
    ) {
      fault.mockRestore();
      throw Error("transcript disk full");
    }
    return append(event);
  });
  try {
    await call("POST", `/pe/threads/${id}/cancel`);
    await until(read, id, (b) => JSON.stringify(b.events).includes("ignoring cancel"));
    await expect.poll(() => killed, { timeout: 2500 }).toBe(true);
    expect((await call("GET", `/pe/threads/${id}`)).status).toBe(200);
  } finally {
    fault.mockRestore();
    await h.close();
  }
});

test("Stop escalation logs a retiring failure as ThreadRetireFailed", async () => {
  const h = await host(undefined, undefined, undefined, undefined, { stopGraceMs: 50 });
  const call = caller(h);
  const read = reader(h);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id: string = created.json.id;
  await call("POST", `/pe/threads/${id}/prompt`, { text: "stubborn" });
  await until(read, id, (b) => lastEcho(b) === "echo: stubborn");
  const stopChild = adapter.stopChild;
  let detached: Parameters<typeof stopChild>[0] = null;
  const stop = vi.spyOn(adapter, "stopChild").mockImplementationOnce((child) => {
    detached = child;
    throw Error("retire rejected");
  });
  const log = vi.spyOn(console, "log");
  try {
    await call("POST", `/pe/threads/${id}/cancel`);
    await expect.poll(() => log.mock.calls.flat().join(" ")).toContain("ThreadRetireFailed");
    expect(log.mock.calls.flat().join(" ")).toContain("retire rejected");
  } finally {
    stop.mockRestore();
    log.mockRestore();
    await settle(stopChild(detached));
    await h.close();
  }
});


test("DocLab terminal burst replays through HTTP beside real mark capture without a false backlog", async () => {
  const dir = await mkdtemp(join(root, "mark-burst-"));
  const identity = { build: "mark-burst", catalog: nativeCatalogIdentity() };
  const bounds = { maxBytes: 1024 * 1024, maxTakings: 100 };
  const writer = await settle(openRecordingWriter(join(dir, "recording"), identity, bounds));
  const live = hostMarks({ changedAt: () => null, subscribe: () => () => {} });
  const marks = await settle(HostDocumentMarks.pipe(Effect.provide(
    HostDocumentMarks.capturing(writer).pipe(Layer.provide(Layer.succeed(HostDocumentMarks, live))),
  )));
  const h = await host();
  const thread = "doclab-burst";
  const ref = { session: "A", openId: "open-A" };
  // Gate c1 copied events seq 49..341: 293 terminal deltas in 328 ms from one skill-file read.
  const events: HarnessEvent[] = Array.from({ length: 293 }, (_, i) => ({
    kind: "update", seq: i + 1, at: new Date(1_000 + i).toISOString(), turnId: "doclab",
    update: { sessionUpdate: "tool_call_update", toolCallId: "read-skill",
      _meta: { terminal_output_delta: { data: `line ${i}\n`, terminal_id: "read-skill" } } },
  }));
  events.push({ kind: "turn_end", seq: 294, at: new Date(1_294).toISOString(),
    turnId: "doclab", stopReason: "end_turn" });
  const cursor = h.log.last;
  for (const event of events) h.log.append({ kind: "thread", thread, event });
  let storm = false;
  const routes = createPeRoutes({
    registrations: [], heads: { observe: () => () => {} },
    store: fileRouteDocumentStore(join(dir, "work")),
    observeHostResource: (request, publish, after) => h.observe(request, publish, after) ?? (() => {
      for (let i = 0; i < (storm ? 65 : 1); i++)
        publish({ kind: "snapshot", key: readingKey(request), value: { takenAt: new Date(1).toISOString() } });
      return () => {};
    })(),
    markReadings: markReadings(marks, (ref, key, at) => ref
      ? settle(marks.readFrame(ref, key, at)) : Promise.resolve(null)),
  });
  const schedule = { kind: "schedule-reading", subject: "catalog", target: ref };
  const connect = async (keys: unknown[], after?: number) => {
    const url = new URL("http://host/pe/resources");
    url.searchParams.set("keys", JSON.stringify(keys));
    if (after !== undefined) url.searchParams.set("after", String(after));
    const response = await routes.fetch(new Request(url));
    expect(response.status).toBe(200);
    return response.body!.getReader();
  };
  const frames = async (stream: ReadableStreamDefaultReader<Uint8Array>, until: (f: any[]) => boolean) => {
    let text = "";
    const result: any[] = [];
    while (!until(result)) {
      const chunk = await stream.read();
      if (chunk.done) throw Error(`Stream closed: ${text}`);
      text += new TextDecoder().decode(chunk.value);
      let end: number;
      while ((end = text.indexOf("\n\n")) >= 0) {
        const block = text.slice(0, end); text = text.slice(end + 2);
        const data = block.split("\n").find(line => line.startsWith("data: "));
        if (data) result.push(JSON.parse(data.slice(6)));
      }
    }
    return result;
  };
  const stream = await connect([{ kind: "thread", thread }, schedule], cursor);
  try {
    const got = await frames(stream, fs => fs.some(f => f.kind === "failure") ||
      (fs.some(f => f.value?.kind === "turn_end") && fs.some(f => f.kind === "snapshot")));
    expect(got.filter(f => f.kind === "failure")).toEqual([]);
    expect(got.filter(f => f.kind === "event").map(f => f.value)).toEqual(events);
    const next: HarnessEvent = { kind: "turn_end", seq: 295, at: new Date(1_295).toISOString(),
      turnId: "next", stopReason: "end_turn" };
    h.log.append({ kind: "thread", thread, event: next });
    expect(await frames(stream, fs => fs.length > 0)).toEqual([
      expect.objectContaining({ kind: "event", value: next }),
    ]);
  } finally { await stream.cancel(); }
  const recorded = await settle(openRecordingReader(join(dir, "recording"), identity, bounds));
  expect(recorded.takingAt(0)?.input.kind).toBe("marks");
  expect(recorded.takingAt(0)?.outcome.kind).toBe("observed");
  // A real snapshot storm still refuses visibly; the fix must not hide capture overflow.
  storm = true;
  const overloaded = await connect([schedule]);
  try {
    const got = await frames(overloaded, fs => fs.some(f => f.kind === "failure"));
    expect(got).toContainEqual(expect.objectContaining({ kind: "failure",
      error: "Mark-frame capture backlog exceeded its bound",
      failure: expect.objectContaining({ code: "ReadingFrameBacklog" }) }));
  } finally { await overloaded.cancel(); }
});
