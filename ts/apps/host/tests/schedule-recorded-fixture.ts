import { testDocumentMarks, captureStore } from "./effect-test.ts";
import { graphRoute } from "../src/reads/routes.ts";
import { Publications } from "../src/reads/evaluator.ts";
import { inputPort } from "../src/reads/inputs.ts";
import { hostMarks } from "../src/document-marks.ts";
import { createPeClient, httpRoutes, servePeRoute } from "@pe/agent-contracts/pe-api";
import { afterEach, expect, vi } from "vite-plus/test";
import { Effect, Fiber, Queue } from "effect";
import { HttpEffect, HttpRouter } from "effect/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleGridRouteState, scheduleReadingSchema, type ScheduleReading, type ActionAdmission, type RouteStatePatch } from "@pe/agent-contracts";
import { hostResourceObserver, markReadings } from "../src/resource-adapters.ts";
import { createPeRoutes, fileRouteDocumentStore } from "../src/pe-routes.ts";
import { createCapabilityCatalogSource } from "../../../packages/mcps/src/pea/capabilities.ts";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { mintContext } from "../src/control.ts";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordingRequest } from "./native-recordings.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
export async function setup(options: { cold?: boolean } = {}) {

  const dir = await mkdtemp(join(tmpdir(), "pe-schedule-chain-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const captures = captureStore(join(dir, "captures"));
  const native = await fixtureNative(join(dir, "native"),
    "fresh-schedule-01-revit.detail.schedules", "fresh-schedule-02-revit.catalog.schedules", "fresh-schedule-03-schedule.cells.apply");
  cleanup.push(() => native.close());
  const socket = await native.connect();
  const b = socket.target;
  const marks = testDocumentMarks(native.bridge);
  let post: (path: string, body: unknown) => Promise<{ status: number; value: any }>;
  const observeHost = hostResourceObserver(native.bridge, () => native.journal, () => captures,
    "http://host", (url, init) => http.request(new Request(url, init)));
  let capabilities: ReturnType<typeof createCapabilityCatalogSource>;
  const publications = new Publications();
  const app = createPeRoutes({
    readGraph: async (request) => {
      const graph = graphRoute("reads.value", request);
      const publication = graph.publication!;
      return graph.publish(publications, publication.subscription, publication.generation, inputPort({
        evaluation: crypto.randomUUID(), origin: () => null, revision: () => 0,
        workspace: app.workspace, marks: hostMarks(marks), run: Effect.runPromise,
        source: {
          workKey: async () => { throw Error("Unexpected Work binding"); },
          file: async () => { throw Error("Unexpected file input"); },
          call: async () => { throw Error("Unexpected native input"); },
          resource: (request) => new Promise((resolve, reject) => {
            let stop = () => {};
            stop = observeHost(request as never, (frame) => {
              if (frame.kind === "snapshot") { stop(); resolve(frame.value); }
              if (frame.kind === "failure") { stop(); reject(Error(frame.error)); }
            });
          }),
        },
      }));
    },
    capabilityCatalog: { read: (scope) => capabilities.read(scope) },
    store: fileRouteDocumentStore(join(dir, "work")),
    heads: { observe: () => () => {} },
    observeHostResource: (request, publish) => observeHost(request, publish),
    // As the host boots: one mark holder per bridge, shared by every Reading and every push.
    markReadings: (observe) => (request, publish) => markReadings(marks, (ref, key, at) => ref ? Effect.runPromise(marks.readFrame(ref, key, at)) : Promise.resolve(null))(observe)(request, publish),
    registrations: [
      {
        spec: scheduleGridRouteState,
      },
    ],
  });
  const work = app.workspace;
  const routes = HttpRouter.use(router => Effect.gen(function* () {
    for (const route of Object.values(httpRoutes)) if (route.owner === "pe")
      yield* router.add(route.method, route.path, HttpEffect.fromWebHandler(request => servePeRoute(request, app.fetch)));
  }));
  const http = native.actions({ workspace: work, marks }, captures, {}, routes);
  // Clients discover this actual isolated listener through the first real response URL.
  const probe = await http.request(new Request("http://host/schedules/readings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: "schedule.grid.snapshot", input: { scheduleId: nativeRecordingRequest("fresh-schedule-01-revit.detail.schedules").query.scheduleIds[0] }, target: b }),
  }));
  const base = new URL(probe.url).origin;
  vi.stubEnv(HOST_CONTEXT_VARIABLE, mintContext({ kind: "human", via: "cli" }));
  capabilities = createCapabilityCatalogSource({ hostBaseUrl: base, registrations: [{ spec: scheduleGridRouteState }],
    machine: async () => machineFixture([{ session: b.session, documents: [{ ...b, address: "C:/model.rvt", title: "Selected", isFamilyDocument: false, isActive: true }] }]) });
  post = async (path, body) => {
    const response = await http.request(new Request(`http://host${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: response.status, value: await response.json() };
  };
  if (!probe.ok) throw Error(await probe.text());
  const reading = scheduleReadingSchema.parse(await probe.json());
  const scope = { binding: "workspace" as const, route: "schedules", target: null, work: reading.workspaceId };
  const view = async (workId = scope.work) => {
    const response = await http.request(new Request(`http://host/pe/work/schedules?work=${encodeURIComponent(workId)}`));
    return await response.json() as { revision: number; doc: { basis?: any; cells: Record<string, any> } };
  };
  // Use the canonical client so Work paths and admission stay production-owned.
  const client = createPeClient(base, (url, init) => http.request(new Request(url, init)));
  const getView = (workId = scope.work) => client.call("work.get", { params: { route: "schedules" }, query: { work: workId } }) as ReturnType<typeof view>;
  const patch = async (patches: RouteStatePatch[]) => (await client.response("work.apply", {
    params: { route: "schedules" }, query: { work: scope.work },
    body: { patches, expectedRevision: (await getView()).revision, press: crypto.randomUUID() },
  })).json();
  const execute = async (value: ActionAdmission) => {
    const response = await post("/actions", value);
    return response.status === 409 ? response.value : native.journal.wait(value.id);
  };
  const bind = async (value: ScheduleReading) => execute({ id: crypto.randomUUID(), key: "schedule.grid.bind", target: { kind: "host" }, input: {
    readingId: value.id, reading: value, expectedRevision: (await getView()).revision,
  } });
  const request = nativeRecordingRequest("fresh-schedule-03-schedule.cells.apply");
  if (!options.cold) {
    expect(await bind(reading)).toMatchObject({ state: "succeeded" });
    expect(await patch(request.edits.map((edit: any) => ({ path: ["cells", `${edit.rowNumber}::${edit.columnNumber}`], value: { edit: { value: edit.value } } })))).toMatchObject({ ok: true });
  }
  const admission = async (id = crypto.randomUUID(), ref = b): Promise<ActionAdmission> => {
    const value: ActionAdmission = { id, key: "schedule.grid.push", target: { kind: "document", ref }, input: { work: { key: scope, revision: (await getView()).revision } } };
    await execute({ ...value, id: `${id}:preview`, key: "schedule.grid.push.preview" });
    return value;
  };
  let hold: Promise<void> | undefined, release = () => {}, onCatalog = () => {};
  native.onRequest(async key => { if (key === "revit.catalog.schedules") onCatalog(); if (key === "schedule.cells.apply") await hold; });
  return {
    dir, base, scope, b, reading, native, request, post, view: getView, patch, bind, admission,
    owner: () => native.journal,
    sent: native.calls,
    read: async () => {
      const response = await post("/schedules/readings", { key: "schedule.grid.snapshot", input: { scheduleId: request.scheduleId }, target: b });
      if (response.status !== 200) throw Error(JSON.stringify(response));
      return scheduleReadingSchema.parse(response.value);
    },
    submit: async (value?: ActionAdmission) => execute(value ?? await admission()),
    select: (...names: string[]) => native.select(...names),
    reads: () => native.calls.filter(call => call.key === "revit.detail.schedules").length,
    onCatalog: (callback: () => void) => { onCatalog = callback; },
    revitChanged: async () => { await Effect.runPromise(Queue.offer(socket.incoming, JSON.stringify({ kind: "Event", event: { eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: [b.openId] }) } }))); },
    bridgeDetached: async () => { await Effect.runPromise(Fiber.interrupt(socket.connection)); },
    hold: () => { hold = new Promise(resolve => { release = resolve; }); }, release: () => release(),
  };
}
