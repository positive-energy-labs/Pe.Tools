import { afterEach, expect, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  scheduleGridRouteState,
  type ScheduleReading,
  type ActionAdmission,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { createPeaRuntime } from "../../../packages/runtime/src/pea-runtime.ts";
import { buildAgentControllerApp } from "../../../packages/runtime/src/agent-controller-web.ts";
import type { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { readScheduleCapture } from "../../../packages/mcps/src/shared/schedule-client.ts";
import { buildCapabilities } from "../../../packages/mcps/src/pea/capabilities.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RevitBridge, BridgeError } from "../src/bridge.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { sdkSessions, sdkEnvelope, originalProcess } from "./native-receipt-fixture.ts";
import { detailResponse } from "./schedule-fixture.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
export async function setup() {
  vi.stubEnv("PE_LANE", "dev");
  const dir = await mkdtemp(join(tmpdir(), "pe-schedule-chain-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const runtime = await createPeaRuntime({ workspaceRoot: dir });
  cleanup.push(async () => {
    await runtime.close?.();
  });
  const captures = new TakeoffCaptures(join(dir, "captures"));
  let work!: RouteWorkspace;
  const app = await buildAgentControllerApp({
    runtime,
    label: "pea",
    capabilityCatalog: {
      read: async () => ({
        at: new Date().toISOString(),
        sources: { catalog: "ok" },
        sessions: [],
        capabilities: buildCapabilities({
          ops: [],
          routes: [scheduleGridRouteState],
          pods: null,
          skills: [],
        }),
      }),
    },
    observeHostResource: (request, publish) =>
      hostResourceObserver(
        bridge,
        () => owner,
        () => captures,
      )(request, publish),
    routeRegistrations: [
      {
        spec: scheduleGridRouteState,
        handlers: {},
        migrate: (raw, scope) => captures.migrateScheduleWork(raw, scope),
      },
    ],
    onRouteWorkspace: (value) => {
      work = value;
    },
  });
  let legacy: { key: string; value: string }[] = [];
  let owner = new ActionJournal(join(dir, "actions.json"), async () => ({
    source: "fixture-legacy",
    rows: legacy,
  }));
  const a = { session: "A", openId: "open-A" },
    b = { session: "B", openId: "open-B" };
  let reopened = false,
    lost = false,
    unknown = false,
    readbackFails = false;
  let hold: Promise<void> | undefined,
    release = () => {};
  let response: unknown = {
    applied: 2,
    dryRun: false,
    results: [
      { index: 0, ok: true },
      { index: 1, ok: true },
    ],
  };
  let detail = detailResponse();
  let readCount = 0;
  const sent: { key: string; input: any; session: string; openId: string; id?: string }[] = [];
  const sessions = () =>
    [a, b].map((target) => ({
      sessionId: target.session,
      processId: 42,
      processStartUtcUnixMs: 1000,
      connected: true,
      state: {
        openDocuments: [
          {
            openId: reopened && target === b ? "reopened-B" : target.openId,
            address: address("C:/Same.rvt"),
            isFamilyDocument: false,
          },
        ],
      },
    }));
  const bridge = {
    list: Effect.sync(sessions),
    subscribe: () => () => {},
    invoke: (key: string, input: unknown, session: string, openId: string, id?: string) =>
      Effect.tryPromise({
        try: async () => {
          sent.push({ key, input, session, openId, id });
          if (key === "revit.catalog.schedules")
            return {
              value: {
                entries: [
                  {
                    scheduleId: 42,
                    name: "Panel",
                    isTemplate: false,
                    visibleBodyRowCount: 1,
                    isPlacedOnSheet: false,
                  },
                ],
              },
            };
          if (key === "revit.detail.schedules") {
            readCount++;
            if (readbackFails && sent.some((s) => s.key === "revit.apply.parameter-values"))
              throw Error("readback unavailable");
            return { value: structuredClone(detail) };
          }
          if (key !== "revit.apply.parameter-values") throw Error(`Unexpected ${key}`);
          await hold;
          if (unknown) throw new BridgeError("lost native reply", 503);
          return { value: structuredClone(response) };
        },
        catch: (error) => error,
      }),
  } as unknown as RevitBridge["Service"];
  const sdk = async (args: readonly string[]) => {
    if (args[0] === "session") return sdkSessions();
    const id = args[2];
    return sdkEnvelope({
      state: "completed",
      requestId: id,
      receipt: {
        requestId: id,
        key: "revit.apply.parameter-values",
        ...originalProcess,
        verdict: "ok",
      },
      response,
    });
  };
  const mount = () =>
    HttpRouter.toWebHandler(
      makeCallRoute(owner, captures, { workspace: work, sdk }).pipe(
        Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
      ),
      { disableLogger: true },
    );
  let server = mount();
  cleanup.push(() => server.dispose());
  const requests: { path: string; body: string; result?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(
      new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://host",
      ),
      init,
    );
    const url = new URL(request.url);
    if (url.pathname.startsWith("/pe/")) {
      const row = {
        path: url.pathname + url.search,
        body: await request.clone().text(),
        result: undefined as unknown,
      };
      requests.push(row);
      const response = await app.fetch(request);
      row.result = await response.clone().json();
      return response;
    }
    const result = await server.handler(request, Context.empty() as never);
    if (lost && url.pathname === "/actions" && request.method === "POST") {
      lost = false;
      throw Error("lost acceptance");
    }
    return result;
  });
  const read = async (target = b) =>
    (await readScheduleCapture(
      "schedule-grid.snapshot",
      { scheduleId: detail.entries[0].scheduleId },
      target,
    )) as ScheduleReading;
  const reading = await read();
  const scope = { route: "schedule-grid", target: null, work: reading.workspaceId };
  const view = async () =>
    (
      await fetch(`/pe/route-state/schedule-grid?work=${scope.work}`)
    ).json() as Promise<{
      revision: number;
      doc: { basis?: { captureId: string }; cells: Record<string, any> };
    }>;
  const patch = async (patches: RouteStatePatch[], actor = "human") => {
    const previous = await view();
    return (
      await fetch(
        `/pe/${actor === "agent" ? "agent/" : ""}route-state/schedule-grid/apply?work=${scope.work}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ patches, expectedRevision: previous?.revision ?? 0 }),
        },
      )
    ).json();
  };
  expect(
    await patch([
      { path: ["basis"], value: { captureId: reading.id } },
      { path: ["cells", "1::2"], value: { staged: { value: "150 VA" } } },
    ]),
  ).toMatchObject({ ok: true });
  const admission = async (id = crypto.randomUUID()): Promise<ActionAdmission> => ({
    id,
    kind: "workflow",
    key: "schedule-grid.apply",
    actor: "human",
    destination: { kind: "document", ref: b },
    input: {},
    bases: { work: { key: scope, revision: (await view()).revision } },
  });
  const post = async (path: string, body: unknown) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: (await response.json()) as any };
  };
  const submit = async (submitted?: ActionAdmission) => {
    const value = submitted ?? (await admission());
    const result = await post("/actions", value);
    return result.status === 409 ? result.value : owner.wait(value.id);
  };
  return {
    dir,
    app,
    requests,
    scope,
    a,
    b,
    captures,
    work,
    view,
    patch,
    read,
    post,
    submit,
    admission,
    sent,
    reading,
    setResponse: (value: unknown) => {
      response = value;
    },
    setDetail: (value: ReturnType<typeof detailResponse>) => {
      detail = value;
    },
    reads: () => readCount,
    reopen: () => {
      reopened = true;
    },
    lose: () => {
      lost = true;
    },
    unknown: () => {
      unknown = true;
    },
    failReadback: (value = true) => {
      readbackFails = value;
    },
    hold: () => {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
    restart: async () => {
      await server.dispose();
      owner = new ActionJournal(join(dir, "actions.json"), async () => ({
        source: "fixture-legacy",
        rows: legacy,
      }));
      server = mount();
    },
    legacy: () => {
      legacy = [
        {
          key: "family-types",
          value: JSON.stringify({
            doc: { cells: {} },
            outcomeUnknown: { command: "push", at: "old" },
          }),
        },
      ];
    },
    owner: () => owner,
  };
}
