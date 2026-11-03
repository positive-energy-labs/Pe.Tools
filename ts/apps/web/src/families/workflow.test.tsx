import { placeInput } from "../shell/admitted-place.test-fixture";
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { actionReceiptSchema, familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import { createBuiltinRouteInventory } from "../../../../packages/agent-contracts/src/route-module";
import { builtinEnrollments } from "../../../host/src/builtin-enrollment";
import { composeHostRouteRegistration } from "../../../host/src/host-route-registration";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
import { createRouteShell } from "../shell/admitted-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { sourceRouteServices } from "../shell/source-route-services";
import { testConsents } from "../../../host/tests/effect-test";
import * as workHost from "../route/host";
import * as actions from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { DEMO_FAMILIES } from "./seeds";
const close: (() => void)[] = [];
afterEach(() => {
  cleanup();
  close
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: [],
  placementScope: "AllLoaded" as const,
};
const document = { session: "fixture", openId: "families" };
const takenAt = "2026-11-03T00:00:00Z";
const key = { binding: "open" as const, route: "families", target: null, open: document };
const family = DEMO_FAMILIES[0]!;
const address = {
  familyName: family.familyName,
  typeName: family.typeNames[0]!,
  parameter: family.parameters[0]!.definition.identity.name,
};
const cell = familyCellKey(address);
const edit = { address, current: "old", value: { value: "new", storageType: "String" as const } };
const settled = (o: any) =>
  new Promise<any>((resolve) =>
    o.subscribe(
      (v: any) => {
        if (v.kind !== "pending") resolve(v);
      },
      () => {},
    ),
  );
async function fixture(unreadable = false) {
  const entry = builtinEnrollments.find((e) => e.routeKey === "families")!;
  expect(entry).toBeDefined();
  const registrations = createRouteRegistrations({
    admittedKeys: [],
    loadedFamilies: async () =>
      DEMO_FAMILIES.map((f) => ({
        familyName: f.familyName,
        types: f.typeNames.map((typeName) => ({ typeName })),
      })),
  });
  const module = composeHostRouteRegistration(await entry.load(), registrations);
  const inventory = createBuiltinRouteInventory({
    families: { host: true, module, closure: entry.closure, catalog: [] },
  });
  const admitted = (await inventory.prepare("families", entry.closure.fingerprint)).admitHost(
    module,
  );
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  expect(createRouteRegistrations().some((r) => r.spec.route === "families")).toBe(false);
  let saved: any = {
    version: 1,
    schemaVersion: 1,
    revision: 0,
    doc: familiesRouteState.schema.parse({ scope: { edit: { value: filter } }, takenAt }),
    history: [],
  };
  if (unreadable)
    saved = {
      version: 1,
      schemaVersion: 1,
      revision: 7,
      doc: { scope: filter, excluded: { [family.familyName]: {} } },
    };
  const states = new Map<string, unknown>([["families", saved]]);
  const host = new RouteWorkspace({
    registrations: createRouteRegistrations(),
    store: {
      getState: async ({ route }) => states.get(route),
      setState: async ({ route, value }) => {
        states.set(route, structuredClone(value));
        if (route === "families") saved = structuredClone(value);
      },
    },
  });
  const registration = host.registerAdmitted(admitted.route);
  close.push(() => registration.close());
  expect(await registration.ready).toBeNull();
  const duplicate = new RouteWorkspace({
    registrations: [{ spec: familiesRouteState }],
    store: { getState: async () => undefined, setState: async () => {} },
  });
  expect(() => duplicate.registerAdmitted(admitted.route)).toThrow(/already|duplicate|registered/i);
  const events: any[] = [];
  const runs = testConsents((_, e) => events.push(e));
  close.push(() => runs.closeAll());
  let run = { thread: "w2g", turn: "1" };
  runs.open(run);
  let applied = 0;
  const receipt = (admission: any, result: any) =>
    actionReceiptSchema.parse({
      ...admission,
      state: "succeeded",
      caller: { kind: "human", via: "local" },
      basis: null,
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: takenAt,
      result,
    });
  const submit = vi.fn(async (admission: any) => {
    if (admission.key === "families.cancel-read") return receipt(admission, { cancelled: true });
    await runs.authorize(
      {
        caller: { kind: "pea", context: "fixture", thread: run.thread, run, root: run },
        run,
        root: run,
      },
      admission.id,
      [{ kind: "file", path: "C:/fixture/families" }],
    );
    applied++;
    return receipt(admission, { fixture: true });
  });
  const observe = observeResources(host, { observe: () => () => {} });
  const door = createWorkFeedClient(
    { subscribe: observe, dirty() {} },
    { write: (k, w) => host.write(k, "families", "human", w), submit },
  );
  let publish: any;
  const observation = {
    id: "matrix",
    work: key,
    document,
    filter,
    capturedAt: takenAt,
    completedAt: takenAt,
    result: { families: DEMO_FAMILIES, issues: [], page: null },
  };
  const services = sourceRouteServices(
    {
      "families.read": {
        kind: "use",
        open(_, deliver) {
          publish = deliver;
        },
      },
      "revit.catalog.loaded-families": {
        kind: "use",
        open(_, deliver) {
          deliver({ kind: "complete", revision: 0, value: { families: DEMO_FAMILIES } });
        },
      },
    },
    { target: () => ({ kind: "document", ref: document }) },
  );
  const web = await loadBuiltinRoute("families", builtinRouteStamp("families"));
  if (!web.ok) throw Error(JSON.stringify(web.diagnostics));
  const mount = createRouteShell({ ...services, work: door }).mount(
    web.route,
    placeInput(
      {
        read: () => new URLSearchParams(),
        write() {},
        subscribe: () => () => {},
      },
      { target: { kind: "document", ref: document } },
    ),
  );
  close.push(mount.close);
  await vi.waitFor(() =>
    expect(unreadable ? mount.workProblem() : mount.workBasis()).not.toBeNull(),
  );
  const read = () => {
    mount.invoke("read", { filter, readId: "00000000-0000-4000-8000-000000000001" });
    publish({ kind: "complete", revision: 1, value: observation });
  };
  return {
    mount,
    host,
    submit,
    read,
    states,
    publish: (v: any) => publish(v),
    observation,
    runs,
    events,
    applied: () => applied,
    rerun: () => {
      runs.closeAll();
      run = { thread: "w2g", turn: "2" };
      runs.open(run);
    },
    saved: () => saved,
  };
}
test("production enrollment, progressive read, two keyed edits, named history, Revert and host refusal", async () => {
  const f = await fixture();
  expect(await settled(f.mount.invoke("pick", filter, f.mount.workBasis()!))).toMatchObject({
    kind: "accepted",
  });
  f.read();
  f.publish({ kind: "part", revision: 2, value: f.observation });
  expect(() => f.mount.invoke("edit", edit, f.mount.workBasis()!)).toThrow(/Reading unavailable/);
  f.publish({ kind: "complete", revision: 3, value: f.observation });
  for (const value of ["first", "second"])
    expect(
      await settled(
        f.mount.invoke("edit", { ...edit, value: { ...edit.value, value } }, f.mount.workBasis()!),
      ),
    ).toMatchObject({ kind: "accepted" });
  expect(JSON.stringify(f.mount.journal())).toContain(address.parameter);
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [cell]: { edit: { value: { value: "second" } } } },
  });
  for (const bad of [
    { ...address, typeName: "Invented" },
    { ...address, familyName: "Invented" },
  ])
    expect(
      await settled(f.mount.invoke("edit", { ...edit, address: bad }, f.mount.workBasis()!)),
    ).toMatchObject({ kind: "refused" });
  await settled(f.mount.invoke("revert", cell, f.mount.workBasis()!));
  expect(f.mount.work()?.value).toMatchObject({ cells: {} });
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [cell]: { edit: { value: { value: "second" } } } },
  });
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  f.mount.invoke("stop", { readId: "00000000-0000-4000-8000-000000000001" });
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalled());
  expect(f.submit.mock.calls[0]![0].key).toBe("families.cancel-read");
});
test("sealed named review refuses stale, Reject retains Work, fresh deadline commits", async () => {
  const f = await fixture();
  f.read();
  await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!));
  const preview = vi.spyOn(actions, "submitAction").mockImplementation(async (a) =>
    actionReceiptSchema.parse({
      ...a,
      state: "succeeded",
      caller: { kind: "human", via: "local" },
      basis: null,
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: takenAt,
      result: {
        previewOnly: true,
        derivedRequest: {},
        seal: {
          requestHash: "sealed",
          work: { handle: a.input.work },
          incarnation: {},
          dependencies: "deps",
        },
        takenAt,
      },
    }),
  );
  f.mount.invoke("apply", {});
  await vi.waitFor(() => expect(f.mount.review("apply")).not.toBeNull());
  expect(f.mount.review("apply")?.rows.join(" ")).toContain(address.familyName);
  await settled(
    f.mount.invoke(
      "edit",
      { ...edit, value: { ...edit.value, value: "newer" } },
      f.mount.workBasis()!,
    ),
  );
  expect(() => f.mount.confirm("apply")).toThrow(/stale/);
  expect(f.submit).not.toHaveBeenCalled();
  f.mount.invoke("apply", {});
  await vi.waitFor(() => expect(f.mount.review("apply")?.stale).toBe(false));
  const rejected: any = f.mount.confirm("apply");
  await vi.waitFor(() => expect(f.events.some((e) => e.kind === "permission_request")).toBe(true));
  const request = f.events.find((e) => e.kind === "permission_request");
  expect(f.runs.decide("w2g", request.requestId, "stop_writes")).toBeTruthy();
  expect(await settled(rejected.accepted)).toMatchObject({ kind: "rejected" });
  expect(f.applied()).toBe(0);
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [cell]: { edit: { value: { value: "newer" } } } },
  });
  f.rerun();
  f.mount.invoke("apply", {});
  await vi.waitFor(() => expect(f.mount.review("apply")?.stale).toBe(false));
  vi.useFakeTimers();
  const approved: any = f.mount.confirm("apply");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await settled(approved.accepted)).toMatchObject({
    kind: "accepted-native",
    outcome: "committed",
  });
  expect(f.applied()).toBe(1);
  expect(preview).toHaveBeenCalledTimes(3);
});
test("real matrix draws and stages an input through the admitted host Work", async () => {
  const f = await fixture();
  f.read();
  HTMLElement.prototype.scrollTo = () => {};
  const view = render(f.mount.read("main") as ReactNode);
  expect(screen.getAllByText(address.familyName).length).toBeGreaterThan(0);
  const editor = view.container.querySelector<HTMLInputElement>("input");
  expect(editor).toBeTruthy();
  editor!.focus();
  fireEvent.change(editor!, { target: { value: "UI value" } });
  await act(async () => fireEvent.keyDown(editor!, { key: "Enter" }));
  await vi.waitFor(() => expect(JSON.stringify(f.mount.work()?.value)).toContain("UI value"));
});

test("production salvage maps unreadable Work through Start fresh and host catalog into carry-over", async () => {
  const f = await fixture(true);
  vi.spyOn(workHost, "startFreshRouteWork").mockImplementation((k) =>
    f.host.startFresh(k, "families", "human"),
  );
  vi.spyOn(workHost, "salvageRouteWork").mockImplementation(
    (k) => f.host.salvage(k, "families") as ReturnType<typeof workHost.salvageRouteWork>,
  );
  expect(f.mount.work()).toBeNull();
  await f.mount.startFresh();
  expect(f.states.has("families:aside:1")).toBe(true);
  expect(f.mount.review("work.salvage")?.stale).toBe(false);
  expect(await settled(f.mount.confirm("work.salvage"))).toMatchObject({ kind: "accepted" });
  expect(f.mount.work()?.value).toMatchObject({
    scope: { edit: { value: filter } },
    excluded: { [family.familyName]: { by: "human" } },
  });
});
test("completion baseline and receipt retirement publications reach the same mounted Work", async () => {
  const f = await fixture();
  f.read();
  const before = f.mount.workBasis()!.workRevision!;
  expect(
    await f.host.publish(
      key,
      "families",
      [{ path: ["takenAt"], value: takenAt }],
      before,
      "read-complete",
    ),
  ).toMatchObject({ ok: true });
  await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!));
  const result = await f.host.publish(
    key,
    "families",
    [{ path: ["cells", cell] }],
    f.mount.workBasis()!.workRevision!,
    "family-receipt",
  );
  expect(result).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(f.mount.work()?.value).toMatchObject({ cells: {} }));
  expect(JSON.stringify(f.mount.journal())).toContain("family-receipt");
});

test("matrix Stop names the read before any progressive frame arrives", async () => {
  const f = await fixture();
  render(f.mount.read("main") as ReactNode);
  fireEvent.click(screen.getByRole("button", { name: "Read families" }));
  const readId = f.mount.page.read().readId;
  expect(readId).toMatch(/^[0-9a-f-]{36}$/);
  fireEvent.click(screen.getByRole("button", { name: "Stop family read" }));
  await vi.waitFor(() =>
    expect(f.submit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "families.cancel-read", input: { readId } }),
    ),
  );
});
