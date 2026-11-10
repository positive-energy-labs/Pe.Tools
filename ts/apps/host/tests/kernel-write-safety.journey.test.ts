import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, catalogWorkSpecs, tools, roomEditKey, type Caller, type WorkKey } from "@pe/agent-contracts";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings, nativeRecordingRequest } from "./native-recordings.ts";
import { testConsents } from "./effect-test.ts";
import { bindControl } from "../src/control.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { nativeFixture } from "./fans-native.fixture.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { HostReceipts } from "../src/gateway-owner.ts";
import { Layer } from "effect";

async function fixture(withPage = false) {
  const dir = await mkdtemp(join(tmpdir(), "pe-write-safety-"));
  const recordings = ["sdk-revit.detail.parameter-links", "sdk-revit.apply.parameter-links"];
  let native = await fixtureNative(join(dir, "native"), ...recordings);
  let socket = await native.connect();
  const makeWorkspace = () => new RouteWorkspace({ registrations: [{ spec: catalogWorkSpecs["parameter-links"] }, { spec: tools.rooms.work }], store: fileRouteDocumentStore(join(dir, "work")) });
  let workspace = makeWorkspace();
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "parameter-links" };
  const body = nativeRecordings("sdk-revit.detail.parameter-links").responses["revit.detail.parameter-links"] as any;
  const { id: _id, ...definition } = body.profile.definitions[0];
  const events: ConsentEvent[] = [];
  const runs = testConsents((_run, event) => events.push(event));
  const run = { thread: crypto.randomUUID(), turn: "write" };
  runs.open(run); bindControl({ runs });
  const caller: Caller = { kind: "pea", context: "safety", thread: run.thread, run, root: run };
  const pageRoot = join(dir, "pages");
  if (withPage) { await mkdir(join(pageRoot, "probe"), { recursive: true }); await writeFile(join(pageRoot, "probe", "index.html"), "<p>Write safety probe</p>", "utf8"); }
  const routes = withPage ? pagesRoute(() => pageRoot, () => join(dir, "pods")).pipe(Layer.provide(Layer.succeed(HostReceipts, native.receipts))) : Layer.empty;
  let post = native.actions({ workspace }, undefined, {}, routes);
  const patch = async (value: unknown) => workspace.publish(key, "parameter-links", [{ path: ["definitions", "authored-extra"], value: { edit: { value } } }], (await workspace.read(key, "parameter-links"))?.revision ?? 0);
  await patch(definition);
  const admit = async (id: string, command: string, actor: Caller = caller) => {
    const response = await post({ id, key: command, target: { kind: "document", ref: socket.target }, input: { work: { key, revision: (await workspace.read(key, "parameter-links"))!.revision } } }, actor);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    return response.json();
  };
  const submit = async (id: string, command: string, actor: Caller = caller) => { await admit(id, command, actor); return native.journal.wait(id); };
  const approve = async () => {
    await vi.waitFor(() => expect(events.some(e => e.kind === "permission_request")).toBe(true));
    const ask = events.findLast(e => e.kind === "permission_request");
    if (ask?.kind !== "permission_request") throw Error("Missing real consent");
    runs.decide(run.thread, ask.requestId, "allow_now");
  };
  const apply = async (id = "apply", actor: Caller = caller) => {
    let done = false;
    const from = events.length;
    const pending = submit(id, "parameter-links.apply", actor).finally(() => { done = true; });
    await vi.waitFor(() => expect(done || events.slice(from).some(e => e.kind === "permission_request")).toBe(true));
    if (!done) await approve();
    return pending;
  };
  return { get native() { return native; }, get workspace() { return workspace; }, get target() { return socket.target; }, key, definition, patch, admit, submit, approve, apply, events,
    send: (body: unknown, actor: Caller = caller) => post(body, actor),
    async control(verb: string, id: string) {
      const response = await post.request(new Request(`http://host/actions/${verb}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }), caller);
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      return response.json();
    },
    async bindPage() {
      const response = await post.request(new Request("http://host/pe/pages/probe/binding", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "thread", thread: "safety-page" }) }));
      expect(response.status, await response.clone().text()).toBe(200);
    },
    async page(command: string, workKey: WorkKey = key) {
      const response = await post.request(new Request("http://host/pages/probe/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: command, input: { work: { key: workKey, revision: (await workspace.read(workKey, workKey.route))!.revision } } }) }));
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      return await response.json() as { id: string };
    },
    async restart() {
      const target = socket.target;
      await native.close();
      native = await fixtureNative(join(dir, "native"), ...recordings);
      socket = await native.connect();
      expect(socket.target).toEqual(target);
      workspace = makeWorkspace();
      post = native.actions({ workspace });
      expect(await native.journal.wait("plan")).toMatchObject({ state: "succeeded" });
    },
    async close() {
      runs.closeAll();
      // Completion can race cleanup's Stop; always close the owning transport scope afterward.
      await Promise.allSettled((await native.journal.list()).filter(row => ["running", "waiting", "queued"].includes(row.state)).map(row => native.journal.cancel(row.id)));
      bindControl({ runs: undefined }); await native.close(); await rm(dir, { recursive: true, force: true });
    },
  };
}

test("R1 a fresh Work handle with identical native intent cannot redeem an older seal", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    const before = (await f.workspace.read(f.key, "parameter-links"))!;
    expect(await f.workspace.publish(f.key, "parameter-links", [], before.revision)).toMatchObject({ ok: true, revision: before.revision + 1 });
    expect((await f.workspace.read(f.key, "parameter-links"))!.doc).toEqual(before.doc);
    expect(await f.apply()).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "preview.stale" } });
    expect(f.native.calls.some(c => c.key === "revit.apply.parameter-links")).toBe(false);
    expect(f.events.some(e => e.kind === "permission_request")).toBe(false);
  } finally { await f.close(); }
});

test.each([false, true])("R8 Page trust after a suspended preparation: revoked=%s", async revoke => {
  const f = await fixture(true);
  let targets = [f.target];
  bindControl({ heads: () => ({ revision: 1, targets: targets.map(ref => ({ request: { kind: "open" as const, ref }, admission: { revision: 1, at: "2026-11-08T05:00:00.000Z", via: "local" as const } })) }) });
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.bindPage();
    const plan = await f.page("parameter-links.apply.plan");
    expect(await f.native.journal.wait(plan.id)).toMatchObject({ state: "succeeded", caller: { kind: "page" } });
    let held = false;
    f.native.onRequest(async key => { if (key === "revit.detail.parameter-links") { held = true; await hold; } });
    const apply = await f.page("parameter-links.apply");
    await vi.waitFor(async () => expect(held, JSON.stringify(await f.native.journal.list(undefined, apply.id))).toBe(true));
    if (revoke) targets = [];
    release();
    const receipt = await f.native.journal.wait(apply.id);
    expect(receipt, JSON.stringify(receipt)).toMatchObject(revoke ? { state: "failed", notDispatched: true, refusal: { kind: "trust" } } : { state: "succeeded" });
    expect(f.native.calls.filter(c => c.key === "revit.apply.parameter-links")).toHaveLength(revoke ? 0 : 1);
  } finally { release(); bindControl({ heads: null }); await f.close(); }
});

test("E2 a repeated action id preserves exact intent and refuses a changed target without redispatch", async () => {
  const f = await fixture();
  try {
    const before = await f.submit("plan", "parameter-links.apply.plan");
    expect(before).toMatchObject({ state: "succeeded" });
    expect(await f.submit("plan", "parameter-links.apply.plan")).toEqual(before);
    const response = await f.send({ id: "plan", key: "parameter-links.apply.plan", target: { kind: "document", ref: { ...f.target, openId: "other-open" } }, input: { work: { key: f.key, revision: (await f.workspace.read(f.key, "parameter-links"))!.revision } } });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("conflicts with its admitted intent or target");
    expect(await f.native.journal.wait("plan")).toEqual(before);
    expect(f.native.calls).toHaveLength(1);
  } finally { await f.close(); }
});

test("R4 a received change still queued in the mark tail refuses the sealed write", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    const change = f.native.changeAfterPreparation("apply", 200);
    const receipt = await f.apply();
    change.stop();
    expect(change.injected()).toBe(true);
    expect(receipt).toMatchObject({ state: "failed", notDispatched: true });
    expect(f.native.calls.some(c => c.key === "revit.apply.parameter-links")).toBe(false);
  } finally { await f.close(); }
});

test("R7 two apply admissions cannot reserve the same reviewed Plan while consent waits", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    await f.admit("first", "parameter-links.apply");
    await vi.waitFor(() => expect(f.events.some(e => e.kind === "permission_request")).toBe(true));
    await f.admit("second", "parameter-links.apply");
    const second = (await f.native.journal.list()).find(row => row.id === "second");
    expect(second).toMatchObject({ state: "failed", notDispatched: true, refusal: { kind: "claimed", by: "first" } });
    expect(f.native.calls.some(c => c.key === "revit.apply.parameter-links")).toBe(false);
    await f.approve();
    expect(await f.native.journal.wait("first")).toMatchObject({ state: "succeeded" });
    expect(f.native.calls.filter(c => c.key === "revit.apply.parameter-links")).toHaveLength(1);
  } finally { await f.close(); }
});

test("R2 a preparation dependency moved during real consent is rederived before writing", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    const pending = f.submit("apply", "parameter-links.apply");
    await vi.waitFor(() => expect(f.events.some(e => e.kind === "permission_request")).toBe(true));
    f.native.select("sdk-earlier-parameter-links");
    await f.approve();
    expect(await pending).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "preview.stale" } });
    expect(f.native.calls.some(c => c.key === "revit.apply.parameter-links")).toBe(false);
  } finally { await f.close(); }
});

test("R3 a new host observation epoch cannot redeem a persisted plan", async () => {
  const f = await fixture();
  try {
    const human: Caller = { kind: "human", via: "local" };
    expect(await f.submit("plan", "parameter-links.apply.plan", human)).toMatchObject({ state: "succeeded" });
    await f.restart();
    expect(await f.apply("apply", human)).toMatchObject({ state: "failed", notDispatched: true });
    expect(f.native.calls.some(c => c.key === "revit.apply.parameter-links")).toBe(false);
  } finally { await f.close(); }
});

test("R5 a real native rehearsal receipt cannot substitute for the declared Plan", async () => {
  const f = await nativeFixture("test");
  try {
    f.select("fresh-ducts.heal.preview", "fresh-ducts.heal");
    expect(await f.saved.apply({ ...f.key, route: "fans" }, "fans", "human", [{ path: ["flows", "8718801", "edit"], value: { value: { cfm: 250 } } }], 0)).toMatchObject({ ok: true });
    const staged = await f.saved.apply(f.key, "ducts", "human", [{ path: ["writeIntent", "edit"], value: { value: { groups: ["group:g8718801"] } } }], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    const input = { work: { key: f.key, revision: staged.revision } };
    for (const [id, key] of [["rehearsal", "ducts.rehearse-heal"], ["apply", "ducts.apply-heal"]]) {
      const response = await f.post("/actions", { id, key, target: f.target, input });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const receipt = await f.journal.wait(id);
      if (id === "rehearsal") {
        expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded", result: { value: { previewOnly: true } } });
        if (receipt.state !== "succeeded") throw Error(JSON.stringify(receipt));
        expect(receipt.result).not.toHaveProperty("seal");
      } else expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "preview.stale" } });
    }
    expect(f.dispatched.filter(call => call.key === "ducts.heal.preview")).toHaveLength(1);
    expect(f.dispatched.filter(call => call.key === "ducts.heal")).toEqual([]);
  } finally { await f.close(); }
});

test("E3/E4 a lost delivered write stays unknown and blocks a fresh overlapping action", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    f.native.loseNextReply("revit.apply.parameter-links");
    const original = await f.apply();
    expect(original, JSON.stringify(original)).toMatchObject({ state: "unknown", steps: expect.arrayContaining([expect.objectContaining({ key: "revit.apply.parameter-links", state: "unknown", dispatchedAt: expect.any(String) })]) });
    const reconnected = await f.native.connect();
    await f.native.deliverLostReply(reconnected);
    expect(await f.native.journal.wait("apply")).toEqual(original);
    expect(await f.submit("new-plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    await f.admit("overlap", "parameter-links.apply");
    const next = (await f.native.journal.list()).find(row => row.id === "overlap");
    expect(next).toMatchObject({ state: "failed", notDispatched: true });
    expect(f.native.calls.filter(call => call.key === "revit.apply.parameter-links")).toHaveLength(1);
    expect(await f.native.journal.wait("apply")).toEqual(original);
  } finally { await f.close(); }
});

test("E3 late native refusal cannot erase a delivered write or release its overlap fence", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    f.native.refuseNextDeliveredReply("revit.apply.parameter-links");
    const original = await f.apply();
    const step = original.steps.find(step => step.key === "revit.apply.parameter-links");
    expect(step).toMatchObject({ state: "unknown", dispatchedAt: expect.any(String), nativeOutcome: "RefusedQueueDisposed" });
    expect(step).not.toHaveProperty("notDispatched");
    expect(original).toMatchObject({ state: "unknown" });
    expect(original).not.toHaveProperty("notDispatched");
    expect(await f.submit("new-plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    await f.admit("overlap", "parameter-links.apply");
    expect((await f.native.journal.list()).find(row => row.id === "overlap")).toMatchObject({ state: "failed", notDispatched: true });
    expect(f.native.calls.filter(call => call.key === "revit.apply.parameter-links")).toHaveLength(1);
    expect(await f.native.journal.wait("apply")).toEqual(original);
  } finally { await f.close(); }
});

test("E7 recovery reads the original native UUID and resume never dispatches a second write", async () => {
  const f = await fixture();
  try {
    expect(await f.submit("plan", "parameter-links.apply.plan")).toMatchObject({ state: "succeeded" });
    f.native.loseNextReply("revit.apply.parameter-links");
    const original = await f.apply();
    expect(original).toMatchObject({ state: "unknown" });
    f.native.makeLostReplyRecoverable();
    const connection = await f.native.connect();
    await f.native.deliverLostReply(connection);
    await f.control("recover", original.id);
    expect(await f.native.journal.wait(original.id)).toMatchObject({ steps: expect.arrayContaining([expect.objectContaining({ key: "revit.apply.parameter-links", state: "succeeded" })]) });
    await f.control("resume", original.id);
    expect(await f.native.journal.wait(original.id)).toMatchObject({ state: "succeeded" });
    expect(f.native.calls.filter(c => c.key === "revit.apply.parameter-links")).toHaveLength(1);
  } finally { await f.close(); }
});

test("E9 a queued Page command loses authority before its first effect", async () => {
  const f = await fixture(true);
  let targets = [f.target], release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  bindControl({ heads: () => ({ revision: 1, targets: targets.map(ref => ({ request: { kind: "open" as const, ref }, admission: { revision: 1, at: "2026-11-08T05:00:00.000Z", via: "local" as const } })) }) });
  let stop = () => {};
  try {
    await f.bindPage();
    f.native.select("fresh-takeoffs.initialize-carrier", "fresh-rooms.write");
    const rooms = { ...f.key, route: "rooms" };
    const request = nativeRecordingRequest("fresh-rooms.write");
    expect(await f.workspace.publish(rooms, "rooms", request.regions.map((room: any) => ({ path: ["edits", roomEditKey(room.guid, "name")], value: { edit: { value: room.name } } })), 0)).toMatchObject({ ok: true });
    const firstPlan = await f.page("parameter-links.apply.plan");
    expect(await f.native.journal.wait(firstPlan.id)).toMatchObject({ state: "succeeded" });
    let held = false;
    f.native.onRequest(async key => { if (key === "revit.apply.parameter-links") { held = true; await hold; } });
    const first = await f.page("parameter-links.apply");
    await vi.waitFor(() => expect(held).toBe(true));
    const secondPlan = await f.page("rooms.write.preview", rooms);
    expect(await f.native.journal.wait(secondPlan.id)).toMatchObject({ state: "succeeded" });
    const second = await f.page("rooms.write", rooms);
    // The journal reports running while waitForTurn holds it before preparation/effects.
    await vi.waitFor(async () => expect((await f.native.journal.list(undefined, second.id))[0]).toMatchObject({ state: "running", prepared: { state: "unprepared" }, steps: [] }));
    stop = f.native.journal.subscribe({ kinds: ["action"] }, receipt => {
      if (receipt.body.kind === "action" && receipt.body.value.id === first.id && receipt.body.value.state === "succeeded") targets = [];
    });
    release();
    expect(await f.native.journal.wait(first.id)).toMatchObject({ state: "succeeded" });
    expect(await f.native.journal.wait(second.id)).toMatchObject({ state: "failed", notDispatched: true, refusal: { kind: "trust" } });
    expect(f.native.calls.filter(call => call.key === "takeoffs.initialize-carrier" || call.key === "rooms.write")).toEqual([]);
  } finally { stop(); release(); bindControl({ heads: null }); await f.close(); }
});
