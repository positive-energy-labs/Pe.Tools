import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, roomEditKey, tools } from "@pe/agent-contracts";
import { captureStore, testRegistry, testDocumentMarks } from "./effect-test.ts";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordingRequest } from "./native-recordings.ts";
import { bindControl } from "../src/control.ts";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";

test.each(["initialize", "adopt", "partition"])("Takeoffs %s preview accepts readWorks and apply dispatches strict native input", async (verb) => {
  const directory = await mkdtemp(join(tmpdir(), "pe-initialize-plan-"));
  const leaf = verb === "initialize" ? "takeoffs.initialize-carrier" : verb === "adopt" ? "takeoffs.adopt" : "takeoffs.partition";
  const action = `takeoffs.${verb}`;
  const native = await fixtureNative(join(directory, "native"), "fresh-takeoffs.initialize-carrier", `fresh-${leaf}`);
  const socket = await native.connect();
  let state: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: tools.takeoffs.work }], store: {
    getState: async () => state, setState: async ({ value }) => { state = structuredClone(value); },
  } });
  const key = { binding: "address" as const, route: "takeoffs", target: address("C:/model.rvt") };
  const post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) }, captureStore(directory));
  try {
    await workspace.publish(key, "takeoffs", [{
      path: ["writeIntent", action],
      value: { edit: { value: verb === "adopt" ? { views: [nativeRecordingRequest(`fresh-${leaf}`)] } : nativeRecordingRequest(`fresh-${leaf}`) } },
    }], 0);
    const work = { key, revision: (await workspace.read(key, "takeoffs"))!.revision };
    const invoke = async (id: string, command: string) => {
      const response = await post({ id, key: command, target: { kind: "document", ref: socket.target }, input: { work, ...(id === "unplanned" ? {} : { readWorks: {} }) } });
      expect([200, 202], await response.clone().text()).toContain(response.status);
      return native.journal.wait(id);
    };
    expect(await invoke("unplanned", action)).toMatchObject({
      state: "failed", notDispatched: true, refusal: { code: "preview.stale" },
    });
    expect(native.calls).toEqual([]);
    expect(await invoke("plan", `${action}.preview`)).toMatchObject({
      state: "succeeded", result: { previewOnly: true },
    });
    expect(native.calls).toEqual([]);
    expect(await invoke("apply", action)).toMatchObject({ state: "succeeded" });
    expect(native.calls.map((call) => call.key)).toEqual(verb === "initialize" ? [leaf] : ["takeoffs.initialize-carrier", leaf]);
    expect(nativeRequestSchema("takeoffs.initialize-carrier").safeParse(native.calls[0]!.input).success).toBe(true);
    expect(nativeRequestSchema(leaf).safeParse(native.calls.at(-1)!.input).success).toBe(true);
  } finally {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["selected", "unrelated", "none"] as const)(
  "recorded rooms.write admission fences %s changes and a current preview reaches both declared leaves",
  async (changed) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-rooms-recorded-"));
    const native = await fixtureNative(join(directory, "native"), "fresh-takeoffs.initialize-carrier", "fresh-rooms.write");
    const socket = await native.connect();
    const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "rooms" };
    const regions = nativeRecordingRequest("fresh-rooms.write").regions as { guid: string; name: string }[];
    const a = roomEditKey(regions[0]!.guid, "name"), b = roomEditKey(regions[1]!.guid, "name");
    let state: unknown;
    const work = new RouteWorkspace({ registrations: [{ spec: tools.rooms.work }], store: {
      getState: async () => state, setState: async ({ value }) => { state = structuredClone(value); },
    } });
    const runs = testRegistry();
    const run = { thread: "rooms-recorded", turn: "write" };
    runs.open(run); bindControl({ runs });
    const post = native.actions({ workspace: work, marks: testDocumentMarks(native.bridge) }, captureStore(directory));
    const submit = async (id: string, command: string, revision: number, caller?: Parameters<typeof post>[1]) => {
      const response = await post({ id, key: command, target: { kind: "document", ref: socket.target }, input: { work: { key, revision } } }, caller);
      expect([200, 202], await response.clone().text()).toContain(response.status);
      return native.journal.wait(id);
    };
    try {
      await work.publish(key, "rooms", regions.map(region => ({ path: ["edits", roomEditKey(region.guid, "name")], value: { edit: { value: region.name } } })), 0);
      const revision = (await work.read(key, "rooms"))!.revision;
      expect(await submit("preview", "rooms.write.preview", revision, { kind: "pea", context: "rooms-recorded", thread: run.thread, run, root: run })).toMatchObject({ state: "succeeded" });
      expect(native.calls).toEqual([]);
      // Pea's write asks nobody (ADR 0038); Work that moved after its preview refuses it at admission.
      if (changed !== "none") await work.publish(key, "rooms", [{ path: ["edits", changed === "selected" ? a : b, "edit", "value"], value: "newer" }], revision);
      const receipt = await submit("write", "rooms.write", revision, { kind: "pea", context: "rooms-recorded", thread: run.thread, run, root: run });
      if (changed === "none") expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
      else {
        expect(receipt).toMatchObject({ state: "failed", notDispatched: true, refusal: { kind: "stale_revision" } });
        expect(native.calls).toEqual([]);
        const latest = (await work.read(key, "rooms"))!.revision;
        expect(await submit("fresh-preview", "rooms.write.preview", latest)).toMatchObject({ state: "succeeded" });
        expect(await submit("fresh-write", "rooms.write", latest)).toMatchObject({ state: "succeeded" });
      }
      expect(native.calls.map(call => call.key)).toEqual(["takeoffs.initialize-carrier", "rooms.write"]);
      const values = regions.map(region => ({ guid: region.guid, name: changed !== "none" && region.guid === regions[changed === "selected" ? 0 : 1]!.guid ? "newer" : region.name }));
      expect(native.calls[1]).toMatchObject({ action: "rooms.write", input: { regions: values } });
    } finally {
      runs.closeAll(); bindControl({ runs: undefined });
      await native.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("invalid derived room GUID refuses before the carrier can mutate the model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-rooms-invalid-"));
  const native = await fixtureNative(join(directory, "native"), "fresh-takeoffs.initialize-carrier", "fresh-rooms.write");
  const socket = await native.connect();
  let state: unknown;
  const work = new RouteWorkspace({ registrations: [{ spec: tools.rooms.work }], store: {
    getState: async () => state, setState: async ({ value }) => { state = value; },
  } });
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "rooms" };
  try {
    await work.publish(key, "rooms", [{ path: ["edits", roomEditKey("invalid-guid", "name")], value: { edit: { value: "Authored room" } } }], 0);
    const response = await native.actions({ workspace: work, marks: testDocumentMarks(native.bridge) })({ id: "invalid-preview", key: "rooms.write.preview", target: { kind: "document", ref: socket.target }, input: { work: { key, revision: 1 } } });
    expect(response.status).toBeLessThan(400);
    expect(await native.journal.wait("invalid-preview")).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "native.input" } });
    expect(native.calls).toEqual([]);
  } finally { await native.close(); await rm(directory, { recursive: true, force: true }); }
});

test("foreign Rooms Work is refused by real action admission before native preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-rooms-foreign-"));
  const native = await fixtureNative(join(directory, "native")); const socket = await native.connect();
  let state: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: tools.rooms.work }], store: {
    getState: async () => state, setState: async ({ value }) => { state = value; },
  } });
  const key = { binding: "address" as const, route: "rooms", target: address("C:/another.rvt") };
  try {
    await workspace.publish(key, "rooms", [{ path: ["edits", roomEditKey(nativeRecordingRequest("fresh-rooms.write").regions[0].guid, "name")], value: { edit: { value: "Intent" } } }], 0);
    const response = await native.actions({ workspace, marks: testDocumentMarks(native.bridge) })({ id: "foreign", key: "rooms.write.preview", target: { kind: "document", ref: socket.target }, input: { work: { key, revision: 1 } } });
    expect(response.status).toBeLessThan(400);
    expect(await native.journal.wait("foreign")).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "work.target" } });
    expect(native.calls).toEqual([]);
  } finally { await native.close(); await rm(directory, { recursive: true, force: true }); }
});
