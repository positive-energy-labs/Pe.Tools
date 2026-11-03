// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { module, scheduleIdentity } from "./kernel";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "../shell/admitted-mount";
import { sourceRouteServices } from "../shell/source-route-services";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";

const close: (() => void)[] = [];
afterEach(() => {
  cleanup();
  close.splice(0).forEach((fn) => fn());
});
async function admit() {
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "fixture",
    variants: [{ client: "web" as const, entry: "schedules/kernel.tsx" }],
    modules: [{ id: "schedules/kernel.tsx", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    schedules: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const result = (await inventory.prepare("schedules", fingerprint)).admit(module);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
async function fixture(name = "read") {
  const open = vi.fn(() => {
    throw Error("Fixture reached transport");
  });
  const route = await admit();
  const shell = createRouteShell(
    sourceRouteServices(
      Object.fromEntries(
        Object.keys(module.entries).map((key) => [key, { kind: "use" as const, open }]),
      ),
    ),
  );
  let search = new URLSearchParams({
    fixture: name,
    workspaceId: scheduleIdentity("schedule:fixture"),
  });
  const mount = shell.mount(route, {
    read: () => search,
    write: (next) => {
      search = next;
    },
    subscribe: () => () => {},
  });
  close.push(mount.close);
  return { mount, open, shell, route };
}
test("real admitted mount draws retained schedule cells and resolves the schedule picker without transport", async () => {
  const { mount, open } = await fixture();
  expect(mount.page.read().workspaceId).toBe(scheduleIdentity("schedule:fixture"));
  expect(mount.picker("workspaceId")).toEqual([
    { id: scheduleIdentity("schedule:fixture"), label: "Mechanical equipment" },
  ]);
  render(mount.read("grid") as ReactNode);
  expect(screen.getByText("IU-1")).toBeTruthy();
  expect(screen.getByText("FXMQ15")).toBeTruthy();
  mount.refresh();
  expect(open).not.toHaveBeenCalled();
});
test("rendered Work basis survives a delayed edit and refuses reuse after publication", async () => {
  const { mount } = await fixture();
  mount.read("grid");
  const basis = mount.workBasis()!;
  const edit = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1"], value: { edit: { value: "replacement" } } }] },
    basis,
  ) as Observation<WorkWriteOutcome>;
  const outcome = await new Promise<WorkWriteOutcome>((resolve) =>
    edit.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(outcome.kind).toBe("accepted");
  expect(mount.work()?.value).toMatchObject({
    cells: { "1::1": { edit: { value: "replacement" } } },
  });
  const stale = mount.invoke("edit", { patches: [] }, basis) as Observation<WorkWriteOutcome>;
  const refused = await new Promise<WorkWriteOutcome>((resolve) =>
    stale.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(refused.kind).toBe("refused");
  expect(mount.work()?.value).toMatchObject({
    cells: { "1::1": { edit: { value: "replacement" } } },
  });
});
test.each(["", "unknown"])(
  "missing fixture %s refuses instead of reading the model",
  async (name) => {
    const { mount, open } = await fixture(name);
    expect(renderToStaticMarkup(mount.read("grid") as ReactNode)).not.toContain("FXMQ15");
    expect(open).not.toHaveBeenCalled();
  },
);

test("decoded admitted subject opens the existing schedule workspace key", async () => {
  const { mount } = await fixture();
  const key = mount.workBasis()!.token.scope.identity.work!;
  expect(key.binding).toBe("workspace");
  if (key.binding !== "workspace") throw Error("Expected schedule workspace");
  expect(key.work).toBe("schedule:fixture");
});

import { applyPatches, scheduleGridRouteState } from "@pe/agent-contracts";

test("G3: top-level cells replacement loses untouched stale marks at the authoritative schedule reducer", () => {
  const doc = scheduleGridRouteState.schema.parse({
    basis: {
      captureId: "a".repeat(64),
      stale: [
        { key: "1::1", was: "a" },
        { key: "1::2", was: "b" },
      ],
    },
    cells: { "1::1": { edit: { value: "a" } }, "1::2": { edit: { value: "b" } } },
  });
  const envelope = { version: 1 as const, revision: 0, doc };
  const patches = [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }];
  const direct = applyPatches(scheduleGridRouteState, envelope, "human", patches, 0);
  expect(direct.ok).toBe(true);
  if (!direct.ok) throw Error("Domain edit refused");
  expect(direct.envelope.doc.basis?.stale).toEqual([{ key: "1::2", was: "b" }]);
  // A root replacement remains lossy; the admitted route must preserve keyed paths.
  const root = applyPatches(
    scheduleGridRouteState,
    envelope,
    "human",
    [{ path: ["cells"], value: direct.envelope.doc.cells }],
    0,
  );
  expect(root.ok).toBe(true);
  if (!root.ok) throw Error("Root replacement refused");
  expect(root.envelope.doc.basis?.stale).toBeUndefined();
});

test("accepted edits undo and redo through the mount's Work history", async () => {
  const { mount } = await fixture();
  const before = mount.work()?.value;
  const observation = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1"], value: { edit: { value: "edited" } } }] },
    mount.workBasis()!,
  ) as Observation<WorkWriteOutcome>;
  await new Promise<void>((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve();
      },
      () => {},
    ),
  );
  const edited = mount.work()?.value;
  expect(edited).not.toEqual(before);
  expect((await mount.history!.undo()).ok).toBe(true);
  expect(mount.work()?.value).toEqual(before);
  expect((await mount.history!.redo()).ok).toBe(true);
  expect(mount.work()?.value).toEqual(edited);
});

import { createFixtureWorkDoor } from "../shell/fixture-work-door";

test("keyed mount edit preserves an untouched stale cell on the real domain Work door", async () => {
  const store = createFixtureWorkDoor(scheduleGridRouteState, {
    basis: {
      captureId: "a".repeat(64),
      stale: [
        { key: "1::1", was: "a" },
        { key: "1::2", was: "b" },
      ],
    },
    cells: { "1::1": { edit: { value: "a" } }, "1::2": { edit: { value: "b" } } },
  });
  const mount = createRouteShell({ ...sourceRouteServices({}), work: store }).mount(await admit(), {
    read: () => new URLSearchParams({ workspaceId: scheduleIdentity("schedule:fixture") }),
    write: () => {},
    subscribe: () => () => {},
  });
  close.push(mount.close);
  const result = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }] },
    mount.workBasis()!,
  ) as Observation<WorkWriteOutcome>;
  const outcome = await new Promise<WorkWriteOutcome>((resolve) =>
    result.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(outcome.kind).toBe("accepted");
  expect(scheduleGridRouteState.schema.parse(mount.work()?.value).basis?.stale).toEqual([
    { key: "1::2", was: "b" },
  ]);
  expect(mount.journal()?.moves.at(-1)?.label).toContain("Cell 1::1");
});

import { scheduleFixtureReading } from "./neutral";
import type { ReadingSource } from "../shell/readings";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { testConsents } from "../../../host/tests/effect-test";
import * as actions from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { actionReceiptSchema } from "@pe/agent-contracts";
import type { JournalSubmission } from "../../../../packages/agent-contracts/src/work-journal-door";

const settle = (o: Observation<WorkWriteOutcome>) => new Promise<WorkWriteOutcome>(resolve => o.subscribe(v => {if(v.kind !== "pending") resolve(v)}, () => {}));
async function interactive() {
  const reading = structuredClone(scheduleFixtureReading);
  reading.snapshot.rows[0]!.bindings = [{columnNumber: 1, targetElementIds: [101], parameterName: "Model", storageType: "String", displayValue: "FXMQ15", isEditable: true, blocker: "None", targets: [{elementId: 101, parameterId: 1, parameterName: "Model", storageType: "String", isReadOnly: false, hasValue: true, rawValue: "FXMQ15"}]}];
  const values: Record<string, unknown> = {"schedules.catalog": {schedules: []}, "schedules.retained": reading, "schedules.saved": reading, "schedules.receipts": []};
  const sources: Record<string, ReadingSource> = Object.fromEntries(Object.entries(values).map(([key,value]) => [key, {kind: "use", open(_, deliver) {deliver({kind: "complete", value, revision: 0})}}]));
  const store = createFixtureWorkDoor(scheduleGridRouteState, {basis: {captureId: reading.id}, cells: {}});
  const services = sourceRouteServices(sources, {target: () => ({kind: "document", ref: reading.target})});
  const mount = createRouteShell({...services, work: store}).mount(await admit(), {read: () => new URLSearchParams({workspaceId: scheduleIdentity(reading.workspaceId)}), write() {}, subscribe: () => () => {}});
  close.push(mount.close);
  return {mount, store, services, reading};
}
test("stale rendered cell refuses visibly in the actual grid", async () => {
  vi.stubGlobal("localStorage", {getItem: () => null, setItem() {}});
  const {mount} = await interactive();
  const view = render(mount.read("grid") as ReactNode);
  const editor = [...view.container.querySelectorAll<HTMLInputElement>("tbody input")].find(i => i.value === "FXMQ15")!;
  expect(editor).toBeTruthy();
  await settle(mount.invoke("edit", {patches: [{path: ["cells", "1::1", "edit"], value: {value: "other"}}]}, mount.workBasis()!) as Observation<WorkWriteOutcome>);
  editor.focus();
  fireEvent.change(editor, {target: {value: "late"}});
  await act(async () => fireEvent.keyDown(editor, {key: "Enter"}));
  await screen.findByText(/document moved to r1/i);
  expect(scheduleGridRouteState.schema.parse(mount.work()?.value).cells["1::1"]?.edit?.value).toBe("other");
});
test("push traverses U8s preview, review, real consent owner, commit and retained readback", async () => {
  const f = await interactive();
  await settle(f.mount.invoke("edit", {patches: [{path: ["cells", "1::1", "edit"], value: {value: "new"}}]}, f.mount.workBasis()!) as Observation<WorkWriteOutcome>);
  const submit = vi.spyOn(actions, "submitAction").mockImplementation(async admission => actionReceiptSchema.parse({...admission, state: "succeeded", caller: {kind: "human", via: "local"}, basis: null, steps: [], prepared: {state: "unprepared"}, recovery: [], startedAt: "2026-11-03T00:00:00Z", result: {previewOnly: true, derivedRequest: {edits: [{key: "1::1", before: "FXMQ15", after: "new"}]}, seal: {requestHash: "sealed", work: {handle: admission.input.work}, incarnation: {}, dependencies: "deps"}, takenAt: "2026-11-03T00:00:00Z"}}));
  try {
    expect(f.mount.invoke("push", {})).toEqual({kind: "preview"});
    await vi.waitFor(() => expect(f.mount.review("push")).not.toBeNull());
    expect(submit.mock.calls[0]![0].key).toBe("schedule.grid.push.preview");
    expect(f.mount.review("push")?.rows.join(" ")).toContain("FXMQ15");
    // Consent is host-owned; re-open the same admitted route with a connected submission port.
    const events: import("../../../host/src/run-consent").ConsentEvent[] = [];
    const runs = testConsents((_,e) => events.push(e));
    const run = {thread: "w3c", turn: "push"}; runs.open(run);
    let committed = false;
    const client = createWorkFeedClient(undefined, {write: async () => {throw Error("unused")}, submit: async admission => {
      await runs.authorize({caller: {kind: "pea", context: "fixture", thread: run.thread, run, root: run}, run, root: run}, admission.id, [{kind: "file", path: "C:/fixture/schedule"}]);
      committed = true;
      return actionReceiptSchema.parse({...admission, state: "succeeded", caller: {kind: "human", via: "local"}, basis: null, steps: [], prepared: {state: "ready", value: null}, recovery: [], startedAt: "2026-11-03T00:00:00Z", result: {value: {failures: [], reading: f.reading}}});
    }});
    const connected = createRouteShell({...f.services, work: {...f.store, submit: c => client.submit(c)}}).mount(await admit(), {read: () => new URLSearchParams({workspaceId: scheduleIdentity(f.reading.workspaceId)}), write() {}, subscribe: () => () => {}});
    close.push(connected.close);
    vi.useFakeTimers();
    try {
      connected.invoke("push", {});
      await vi.advanceTimersByTimeAsync(0);
      expect(connected.review("push")).not.toBeNull();
      const command = connected.confirm("push") as JournalSubmission;
      await vi.advanceTimersByTimeAsync(0);
      expect(events.some(e => e.kind === "permission_request")).toBe(true);
      expect(committed).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(committed).toBe(true);
      let outcome: unknown; command.accepted.subscribe(v => {outcome = v}, () => {});
      expect(outcome).toMatchObject({kind: "accepted-native", outcome: "committed"});
      expect(connected.read("grid")).toBeTruthy();
    } finally {runs.closeAll(); vi.useRealTimers()}
  } finally {submit.mockRestore()}
});
