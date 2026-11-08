import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, catalogWorkSpecs, type Caller } from "@pe/agent-contracts";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings } from "./native-recordings.ts";
import { testDocumentMarks, testConsents } from "./effect-test.ts";
import { bindControl } from "../src/control.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-write-safety-"));
  const recordings = ["sdk-revit.detail.parameter-links", "sdk-revit.apply.parameter-links"];
  let native = await fixtureNative(join(dir, "native"), ...recordings);
  let socket = await native.connect();
  const makeWorkspace = () => new RouteWorkspace({ registrations: [{ spec: catalogWorkSpecs["parameter-links"] }], store: fileRouteDocumentStore(join(dir, "work")) });
  let workspace = makeWorkspace();
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "parameter-links" };
  const body = nativeRecordings("sdk-revit.detail.parameter-links").responses["revit.detail.parameter-links"] as any;
  const { id: _id, ...definition } = body.profile.definitions[0];
  const events: ConsentEvent[] = [];
  const runs = testConsents((_run, event) => events.push(event));
  const run = { thread: crypto.randomUUID(), turn: "write" };
  runs.open(run); bindControl({ runs });
  const caller: Caller = { kind: "pea", context: "safety", thread: run.thread, run, root: run };
  let post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) });
  const patch = async (value: unknown) => workspace.publish(key, "parameter-links", [{ path: ["definitions", "authored-extra"], value: { edit: { value } } }], (await workspace.read(key, "parameter-links"))?.revision ?? 0);
  await patch(definition);
  const submit = async (id: string, command: string, actor: Caller = caller) => {
    const response = await post({ id, key: command, target: { kind: "document", ref: socket.target }, input: { work: { key, revision: (await workspace.read(key, "parameter-links"))!.revision } } }, actor);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    return native.journal.wait(id);
  };
  const approve = async () => {
    await vi.waitFor(() => expect(events.some(e => e.kind === "permission_request")).toBe(true));
    const ask = events.findLast(e => e.kind === "permission_request");
    if (ask?.kind !== "permission_request") throw Error("Missing real consent");
    runs.decide(run.thread, ask.requestId, "allow_now");
  };
  const apply = async (id = "apply", actor: Caller = caller) => {
    let done = false;
    const pending = submit(id, "parameter-links.apply", actor).finally(() => { done = true; });
    await vi.waitFor(() => expect(done || events.some(e => e.kind === "permission_request")).toBe(true));
    if (!done) await approve();
    return pending;
  };
  return { get native() { return native; }, get workspace() { return workspace; }, key, definition, patch, submit, approve, apply, events,
    async restart() {
      const target = socket.target;
      await native.close();
      native = await fixtureNative(join(dir, "native"), ...recordings);
      socket = await native.connect();
      expect(socket.target).toEqual(target);
      workspace = makeWorkspace();
      post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) });
      expect(await native.journal.wait("plan")).toMatchObject({ state: "succeeded" });
    },
    async close() { runs.closeAll(); bindControl({ runs: undefined }); await native.close(); await rm(dir, { recursive: true, force: true }); },
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
