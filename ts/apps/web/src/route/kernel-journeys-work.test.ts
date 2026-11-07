import { join } from "node:path";
import { Context, Layer } from "effect";
import { HttpRouter } from "effect/http";
// Host-only dependency: this HTTP journey lives beside web route journeys.
import {
  NodeHttpClient,
  NodeServices,
} from "../../../host/node_modules/@effect/platform-node/dist/index.js";
import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { RouteWorkspace } from "@pe/runtime";
import { commands, tools, roomEditKey, takeoffObservationSchema } from "@pe/agent-contracts";
import { takeoffSeeds } from "../takeoff/seeds";
import { fileVersion } from "../../../host/src/takeoff-actions";
import { detachedBridge, sessionView, captureStore, testDuctFiles, testDocumentMarks } from "../../../host/tests/effect-test";
import { sdkSessions } from "../../../host/tests/native-receipt-fixture";
import { hostOwnership } from "../../../host/src/host-ownership";
import { bindCommandRuntime } from "../../../host/src/command-registry";
import { commandLeafRefusal } from "../../../host/src/bridge";
import { catalogCommandContext } from "../../../host/src/catalog-command-context";
import { markDispatched } from "../../../host/src/action-dispatch";
import {
  actionReceiptSchema,
  workFingerprintSchema,
  type Caller,
  type WorkKey,
  type WorkWrite,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { fixture, ref, path, who, gate } from "../../../host/tests/host-read-graph.test-support";
import { builtinEnrollments } from "../../../host/src/builtin-enrollment";
import { ActionJournal } from "../../../host/src/action-journal";
import { makeCallRoute } from "../../../host/src/call-route";
import { nativeReadRoot } from "../../../host/src/app";
import { RevitBridgeLive, RevitBridge } from "../../../host/src/bridge";
import { DuctFiles } from "../../../host/src/ducts-files";
import { HostDocumentMarks } from "../../../host/src/document-marks";
import { PictureCaptureStore } from "../../../host/src/captures-route";
import { createPeRoutes } from "../../../host/src/pe-routes";
import { RequestIdentity, admittedRequestIdentity } from "../../../host/src/request-services";
import { bindControl } from "../../../host/src/control";
import { testConsents } from "../../../host/tests/effect-test";
import type { ConsentEvent } from "../../../host/src/run-consent";
import { module as fans } from "../fans/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { routeInput } from "./host";
import { localId } from "./typed-route";
import type { Readings } from "../host/resource-stream";
import type { UseSource } from "../shell/source-contract";
import type { DrawContext } from "./typed-route";

test.each([
  ["takeoffs.initialize", { stage: "Adoption" }],
  ["takeoffs.adopt", { views: [{ view: "Zoning plan", items: [{ elementId: 21, name: "Office", systemTag: "SA1" }] }] }],
  ["takeoffs.partition", { zoneRegion: 21, view: "Zoning plan", zoneName: "Office", zoneGuid: "zone-a" }],
  ["rooms.partition", { view: "Zoning plan" }],
  ["rooms.draw", { view: "Zoning plan", loops: [[[0, 0], [10, 0], [10, 10]]] }],
  ["rooms.write", {}],
  ["rooms.merge", { view: "Zoning plan", guids: ["room-a", "room-b"] }],
  ["takeoffs.sync", {}],
] as const)("JZ carrier commands run real declarations and guarded native dispatch: %s", async (commandKey, intent) => {
  const dir = await mkdtemp(join(tmpdir(), "jz-takeoffs-leaf-"));
  const route = commandKey.startsWith("rooms.") ? "rooms" : "takeoffs";
  const key = { binding: "address" as const, target: path, route };
  let saved: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: tools[route].work }], store: {
    getState: async () => saved, setState: async ({ value }) => { saved = structuredClone(value); },
  } });
  const calls: { key: string; input: unknown; command: string | undefined }[] = [];
  const bridge = detachedBridge({
    list: Effect.succeed([sessionView({ sessionId: ref.session, connected: true, processId: 42,
      processStartUtcUnixMs: 1000, lane: hostOwnership.lane, sourceRoot: hostOwnership.sourceRoot,
      serviceName: hostOwnership.serviceName,
      state: { openDocuments: [{ ...ref, address: path, isActive: true, isFamilyDocument: false }] },
    })]),
    // Recorded native transport only. Run the production guard with the registry's actual
    // AsyncLocalStorage command, before recording any dispatch or returning native data.
    invoke: (leaf, input, session, document, id) => Effect.promise(async () => {
      const command = catalogCommandContext.getStore();
      const refusal = commandLeafRefusal(leaf, command);
      if (refusal) throw Error(refusal);
      await markDispatched(id!);
      calls.push({ key: leaf, input, command });
      return { target: { session: session!, document: document ?? null },
        value: leaf === "takeoffs.initialize-carrier" ? { remaining: [] } : { adopted: [21], written: 1 } };
    }),
  });
  const journal = new ActionJournal(join(dir, "actions.jsonl"), Date.now);
  const runs = testConsents(() => {});
  bindControl({ runs, acquired: () => null });
  const captures = captureStore(dir);
  const identity = { fileName: "recorded.r10", projectTitle: "Journey", clientName: "", stamp: "recorded" };
  let synced = false;
  const deps: Parameters<typeof bindCommandRuntime>[3] = {
    workspace, sdk: sdkSessions, files: testDuctFiles(), marks: testDocumentMarks(bridge),
    openFile: async file => ({ sourceFile: file, fileIdentity: identity, building: {}, systems: [{ number: 1, name: "SA1" }], rooms: [] }),
    syncFile: async input => {
      synced = true;
      return { targetPath: input.targetPath, backupPath: null, swapped: true, fileIdentity: identity,
        insertedRooms: (input.inserts ?? []).map(room => ({ number: room.number, name: room.name, identifier: room.number + 100 })),
        updated: 0, systems: [], seedRoom: { identifier: 0, action: "not-requested", reason: "recorded adapter" },
        assemblyFallbacks: [], roomsBefore: 0, roomsAfter: input.inserts?.length ?? 0, log: "recorded adapter" };
    },
  };
  const web = HttpRouter.toWebHandler(
    makeCallRoute(journal, captures, deps).pipe(
      nativeReadRoot(),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(dir, "pictures"))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ), { disableLogger: true },
  );
  const invoke = async (key: string, input: Record<string, unknown>) => {
    const id = `${key}-${(await journal.list()).length}`;
    const response = await withInvocationContext({ caller: who }, () => web.handler(
      new Request("http://host/actions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, key, target: { kind: "document", ref }, input }) }),
      Context.make(RequestIdentity, admittedRequestIdentity(who, {})),
    ));
    expect([200, 202], await response.clone().text()).toContain(response.status);
    const receipt = await journal.wait(id);
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    return receipt;
  };
  try {
    let authored: Record<string, unknown> = intent;
    if (commandKey === "takeoffs.sync") {
      const recorded = takeoffObservationSchema.parse(takeoffSeeds.sync.readings.snapshot);
      if (recorded.kind !== "ready") throw Error("Expected a saved snapshot seed");
      const snapshot = structuredClone(recorded.capture.snapshot);
      snapshot.reading.at = path;
      const zone = snapshot.world.zones[0]!;
      const room = zone.rooms.find(room => room.data !== null)!;
      zone.rooms = [room]; zone.tags = ["SA1"]; zone.driftSqft = 0; zone.runs = [];
      room.r10 = null; room.elementId = 21; room.flags = [];
      room.analysis = { state: "current", hold: null, runId: null, floorZ: null, ceilingZ: null };
      snapshot.world.zones = [zone];
      const retained = await captures.refresh(ref, async () => ({ result: null, snapshot }), async () => true);
      const file = join(dir, "recorded.r10");
      await writeFile(file, "recorded RHVAC transport input", "utf8");
      authored = { path: file, captureId: retained.capture.id, fileVersion: await fileVersion(file), zones: [zone.zone.guid] };
    }
    const edits = commandKey === "rooms.write" ? [{ path: ["edits", roomEditKey("room-a", "name")], value: { edit: { value: "Office" } } }] : [];
    await workspace.publish(key, route, [
      { path: ["writeIntent", commandKey], value: { edit: { value: authored } } }, ...edits,
    ], 0);
    const work = { key, revision: (await workspace.read(key, route))!.revision };
    const definition = commands[commandKey];
    if ("writeBoundary" in definition) {
      const plan = await invoke(definition.writeBoundary.previewKey, { work });
      expect(plan).toMatchObject({ result: { previewOnly: true } });
      expect(calls, "A plan never dispatches a carrier mutation").toEqual([]);
    }
    await invoke(commandKey, { work });
    if (commandKey === "takeoffs.sync") {
      expect(synced).toBe(true);
      expect(calls).toEqual([{ key: "takeoffs.rhvac-links", command: commandKey,
        input: { writes: [{ elementId: 21, link: expect.objectContaining({ identifier: 101, fileIdentity: "recorded.r10#recorded" }) }] } }]);
      return;
    }
    expect(calls[0]).toEqual({ key: "takeoffs.initialize-carrier", input: {
      stage: commandKey === "takeoffs.partition" ? "Materialization" : commandKey.startsWith("rooms.") ? "Rooms" : "Adoption",
    }, command: commandKey });
    expect(calls.map(row => row.key)).toEqual(commandKey === "takeoffs.initialize"
      ? ["takeoffs.initialize-carrier"] : ["takeoffs.initialize-carrier", commandKey]);
    expect(calls.every(row => row.command === commandKey)).toBe(true);
    expect(commandLeafRefusal("takeoffs.initialize-carrier", "page.publish"), "Unrelated commands still cannot invoke the Internal leaf").toContain("does not declare");
  } finally {
    await web.dispose();
    runs.closeAll(); bindControl({ runs: undefined });
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

// Only recorded native inputs and the address bar are adapters. Work, HTTP, SSE,
// the action registry, consent, journal and typed mount all run their production code.
async function journey() {
  const host = await fixture(true);
  const roster = await host.send(0, []);
  const fan = roster.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
  const journal = new ActionJournal(join(host.dir, "actions.jsonl"), Date.now);
  const events: ConsentEvent[] = [];
  const runs = testConsents((_run, event) => events.push(event));
  bindControl({ runs, acquired: () => null });
  const web = HttpRouter.toWebHandler(
    makeCallRoute(journal, undefined, { workspace: host.workspace }).pipe(
      nativeReadRoot(),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(host.dir, "pictures"))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(RevitBridgeLive),
    ),
    { disableLogger: true },
  );
  const api = createPeRoutes({
    workspace: host.workspace,
    registrations: [],
    navigation: { threads: async () => [], documents: async () => [{ ...ref, address: path }] },
  });
  const request = (url: string, body?: unknown, caller: Caller = who, headers = {}) => {
    const req = new Request(new URL(url, "http://host"), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return withInvocationContext({ caller }, () =>
      url.startsWith("/actions") || url === "/call"
        ? web.handler(req, Context.make(RequestIdentity, admittedRequestIdentity(caller, {})))
        : api.fetch(req),
    );
  };
  const streams = new Set<() => void>();
  const source: Readings = {
    subscribe(reading, deliver) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        closed = false;
      const stop = () => {
        closed = true;
        void reader?.cancel();
        streams.delete(stop);
      };
      streams.add(stop);
      void (async () => {
        const url = new URL(peRouteUrl("resources.stream", {}), "http://host");
        url.searchParams.set("keys", JSON.stringify([reading]));
        const response = await request(url.pathname + url.search);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        reader = response.body!.getReader();
        if (closed) return void reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of frame.split("\n"))
              if (line.startsWith("data: ")) deliver(JSON.parse(line.slice(6)));
          }
        }
      })();
      return stop;
    },
    dirty() {},
  };
  const write = async (key: WorkKey, body: WorkWrite, caller: Caller = who) => {
    const response = await request(
      peRouteUrl("work.apply", routeInput(key.route, key)),
      body,
      caller,
    );
    const value = await response.json();
    return (response.ok ? value : (value.error?.details ?? value)) as RouteStateWriteResult;
  };
  let heldWrite: ReturnType<typeof gate> | undefined;
  const work = createWorkFeedClient(source, {
    write: async (key, body) => {
      const held = heldWrite; heldWrite = undefined;
      const result = await write(key, body);
      if (held) { held.entered.resolve(); await held.release.promise; }
      return result;
    },
    submit: async (command) => {
      const response = await request("/actions", command);
      expect([200, 202], await response.clone().text()).toContain(response.status);
      await journal.wait(command.id);
      const settled = await request(`/actions?id=${command.id}`);
      return actionReceiptSchema.parse((await settled.json())[0]);
    },
  });
  let generation = 0,
    current = true;
  const pending = new Set<Promise<void>>();
  const read: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const id = ++generation;
      const task = host
        .send(id, (ctx.args as { fan: string[] }).fan, undefined, `jw-${id}`)
        .then((value) => {
          deliver({ kind: "complete", value, revision: value.version });
        });
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  const fingerprint = workFingerprintSchema.parse(
    `builtin-closure:${builtinEnrollments.find((e) => e.routeKey === "fans")!.closure.fingerprint}`,
  );
  const input = {
    target: { kind: "document" as const, ref },
    fixture: null,
    work: { address: path, open: ref },
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    custody: { current: () => current },
    memory: () => ({
      fan: { kind: "ids", ids: [localId("ducts-fan", `${fan.uniqueId}@${fan.portIndex}`)] },
    }),
  };
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const mount = (readOnly = false, place: Partial<typeof input> = {}) => {
    const m = mountTypedRoute(fans, { ...input, ...place, readOnly }, fingerprint, {
      work,
      sources: { "fans.sheet": read },
    });
    mounts.push(m);
    m.subscribe(() => {});
    return m;
  };
  const m = mount();
  const ready = () => {
    // The recorded HTTP read adapter has no graph invalidation socket. Use the
    // route's explicit Refresh door after a Work acknowledgement.
    m.refresh();
    return vi.waitFor(
      () => {
        expect(m.value()).toMatchObject({ current: true });
        if (m.owner()?.ready) expect(m.problem()).toBeNull();
      },
      { timeout: 20_000 },
    );
  };
  const cells = () =>
    m.draw("sheet-inputs", (ctx) => ctx.cells) as DrawContext<any, any, any, any>["cells"];
  const key = () => m.owner()!.handle!.key;
  return {
    host,
    journal,
    request,
    write,
    runs,
    events,
    m,
    mount,
    ready,
    cells,
    key,
    holdWrite() { heldWrite = gate(); return heldWrite; },
    depart() {
      current = false;
    },
    async start() {
      await ready();
      await vi.waitFor(() => expect(m.owner()?.absent).toBe(true));
      await vi.waitFor(() => expect(m.owner("ducts")?.absent).toBe(true));
      await m.startAction()!.run();
      await vi.waitFor(() => expect(m.owner()?.ready).toBe(true));
      await vi.waitFor(() => expect(m.owner("ducts")?.ready).toBe(true));
      await ready();
    },
    async close() {
      mounts.forEach((m) => m.dispose());
      streams.forEach((stop) => stop());
      await Promise.allSettled([...pending]);
      runs.closeAll();
      await web.dispose();
      await journal.close();
      await host.close();
    },
  };
}

test("JW1 edit typed flows and race two atomic HTTP writes at the accepted revision", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(
      await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Terminal A airflow" }),
      "H02: typed flow commits",
    ).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc);
    const expectedRevision = j.m.owner()!.handle!.revision;
    const malformed = await j.write(j.key(), {
      kind: "apply",
      expectedRevision,
      press: crypto.randomUUID(),
      patches: [
        { path: ["flows", "4", "edit"], value: { value: { cfm: "wrong" } } },
        { path: ["undeclared"], value: 1 },
      ],
    });
    expect(malformed, "H02: malformed values and undeclared fields refuse at HTTP").toMatchObject({
      ok: false,
    });
    expect(j.m.owner()!.doc, "H08: malformed batch changes no path").toEqual(before);
    const contenders = await Promise.all(
      [410, 520].map((cfm) =>
        j.write(j.key(), {
          kind: "apply",
          expectedRevision,
          press: crypto.randomUUID(),
          label: `Set both flows to ${cfm}`,
          patches: ["4", "999"].map((id) => ({
            path: ["flows", id, "edit"],
            value: { value: { cfm } },
          })),
        }),
      ),
    );
    expect(
      contenders.filter((r) => r.ok),
      "H08: exactly one concurrent revision is acknowledged",
    ).toHaveLength(1);
    expect(
      contenders.filter((r) => !r.ok),
      "H08: the other writer is refused",
    ).toHaveLength(1);
    await vi.waitFor(() => expect(j.m.owner()!.handle!.revision).toBe(expectedRevision + 1));
    await j.ready();
    expect(
      j.m.owner()!.doc.flows["4"].edit.value,
      "H08: both paths belong to the same atomic winner",
    ).toEqual(j.m.owner()!.doc.flows["999"].edit.value);
  } finally {
    await j.close();
  }
}, 60_000);

test("JM B06 complete an acknowledged HTTP edit after its typed Page is disposed", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.start();
    held = j.holdWrite();
    const writing = j.cells().at(["flows", "4"]).stage({ cfm: 410 }, { label: "Departing airflow" });
    await held.entered.promise;
    j.m.dispose();
    const retired = structuredClone(j.m.owner()!.doc);
    held.release.resolve();
    await writing;
    expect(j.m.owner()!.doc, "B06: a retired pane cannot receive a late Work completion").toEqual(retired);
    const replacement = j.mount();
    await vi.waitFor(() => expect(replacement.owner()?.ready).toBe(true));
    expect(replacement.owner()!.doc.flows["4"].edit.value,
      "H03: the host acknowledgement stays durable for a new inspection").toEqual({ cfm: 410 });
  } finally { held?.release.resolve(); await j.close(); }
}, 60_000);

test("JW2 receive Pea proposals, accept and deny individual cells without changing stored facts", async () => {
  const j = await journey();
  try {
    await j.start();
    const by: Caller = { kind: "pea", context: "jw", thread: "jw-proposals" };
    const stored = structuredClone(j.m.value().value.sheetSnapshot);
    expect(
      stored.nodes.length,
      "H20: proposal journey starts with actual recorded native facts",
    ).toBeGreaterThan(0);
    const revision = j.m.owner()!.handle!.revision;
    const proposal = await j.write(
      j.key(),
      {
        kind: "apply",
        expectedRevision: revision,
        press: crypto.randomUUID(),
        label: "Propose two flows",
        patches: [
          { path: ["flows", "4"], value: { edit: { value: { cfm: 250 } } } },
          { path: ["flows", "999"], value: { edit: { value: { cfm: 350 } } } },
        ],
      },
      by,
    );
    expect(
      proposal,
      `H20: typed proposals are acknowledged: ${JSON.stringify(proposal)}`,
    ).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(j.m.owner()!.handle!.revision).toBeGreaterThan(revision));
    await j.ready();
    const b = structuredClone(j.m.owner()!.doc.flows["999"]);
    expect(j.m.owner()!.doc.flows["4"].edit.by, "H20: proposed authorship is Pea").toBe("pea");
    expect(
      await j.cells().at(["flows", "4"]).accept({ label: "Take A proposal" }),
      "H20: human takes only A",
    ).toBeNull();
    await j.ready();
    expect(j.m.owner()!.doc.flows["4"].edit.by).toBe("human");
    expect(j.m.owner()!.doc.flows["999"], "H20: unrelated proposal is intact").toEqual(b);
    expect(
      await j.cells().at(["flows", "999"]).deny({ label: "Deny B proposal" }),
      "H20: deny removes only pending B",
    ).toBeNull();
    await j.ready();
    expect(j.m.owner()!.doc.flows["999"]?.edit, "H20: deny clears the proposed edit").toBeNull();
    expect(
      j.m.value().value.sheetSnapshot,
      "H20: stored native facts survive proposal transitions",
    ).toEqual(stored);
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 250 });
  } finally {
    await j.close();
  }
}, 60_000);

test("JM H27 interleave a second writer, refuse the original undo and keep its named history", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Set terminal airflow" })).toBeNull();
    await j.ready();
    const step = j.m.history.entries.at(-1)!;
    expect(await j.m.history.undo(step.press), "H07: typed Work undoes the named edit").toMatchObject({ ok: true });
    await j.ready();
    expect(await j.m.history.redo(step.press), "H07: typed Work redoes the same edit").toMatchObject({ ok: true });
    await j.ready();
    const result = await j.write(j.key(), { kind: "apply", expectedRevision: j.m.owner()!.handle!.revision,
      press: crypto.randomUUID(), label: "Another designer changes airflow",
      patches: [{ path: ["flows", "4", "edit"], value: { value: { cfm: 500 } } }] });
    expect(result).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 500 }));
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc), revision = j.m.owner()!.handle!.revision;
    const undo = await j.m.history.undo(step.press);
    expect(undo, "H27: a changed affected path refuses its original inverse").toMatchObject({ ok: false });
    expect(j.m.owner()!.doc, "H27: conflicting undo changes no path").toEqual(before);
    expect(j.m.owner()!.handle!.revision, "H27: no inverse retry writes a new revision").toBe(revision);
    expect(j.m.history.entries.some(entry => entry.press === step.press), "H27: the named entry survives refusal").toBe(true);
  } finally { await j.close(); }
}, 60_000);

test("JM H01/H13 hide one document, inspect another and reopen the first named Work history", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Terminal A design airflow" })).toBeNull();
    await j.ready();
    const firstKey = j.m.owner()!.scope.key;
    j.m.release();
    const other = j.mount(false, { work: { address: path.replace("Chadds", "Other") as typeof path, open: ref } });
    await vi.waitFor(() => expect(other.owner()?.absent).toBe(true));
    expect(other.owner()!.scope.key, "H01: a second document acquires its own Work").not.toEqual(firstKey);
    expect(j.m.owner()!.scope.key, "H01: a hidden Place cannot acquire the active document's Work").toEqual(firstKey);
    other.dispose();
    const reopened = j.mount();
    await vi.waitFor(() => expect(reopened.owner()?.ready).toBe(true));
    expect(reopened.owner()!.scope.key).toEqual(firstKey);
    expect(reopened.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 240 });
    expect(JSON.stringify(reopened.journal()), "H13: cold reopening retains the human action label").toContain("Terminal A design airflow");
  } finally { await j.close(); }
}, 60_000);

test("JM H12 leave a Page with drawn cells, inspect it, and refuse both old edits and native planning", async () => {
  const j = await journey();
  try {
    await j.start();
    const cell = j.cells().at(["flows", "4"]), before = structuredClone(j.m.owner()!.doc);
    const receipts = (await j.journal.list()).length;
    j.depart();
    expect(j.m.value().value, "H12: departure preserves inspection").toBeDefined();
    expect(await cell.stage({ cfm: 700 }, { label: "Late airflow" }), "H12: captured cell cannot write after departure").toMatchObject({ code: "refused" });
    await expect(j.m.action("losses").plan(), "H12: departure cannot acquire a new native plan").rejects.toThrow("Place");
    expect(j.m.owner()!.doc).toEqual(before);
    expect((await j.journal.list()).length, "H12: neither path submits a native action").toBe(receipts);
  } finally { await j.close(); }
}, 60_000);

test("JM H30 refuse a stale drawn edit and retain its original intent across refresh", async () => {
  const j = await journey();
  try {
    await j.start();
    const old = j.cells().at(["flows", "4"]);
    expect(await j.cells().at(["flows", "999"]).stage({ cfm: 300 }, { label: "Newer sibling edit" })).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc);
    expect(await old.stage({ cfm: 731 }, { label: "Keep my original airflow" })).toMatchObject({ code: "refused" });
    await j.ready();
    expect(j.m.owner()!.doc, "H30: stale intent never recomputes on newer Work").toEqual(before);
    expect(JSON.stringify(j.m.journal()), "H30: rejected input remains inspectable until explicit discard").toContain("Keep my original airflow");
  } finally { await j.close(); }
}, 60_000);
