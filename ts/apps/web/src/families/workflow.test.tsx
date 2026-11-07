import { placeInput } from "../shell/admitted-place.test-fixture";
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useMemo, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { AdmittedRouteView, admittedRouterAddress } from "../shell/admitted-pane";
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
import { createChatPageStore } from "../workbench/store";
import { appAtomRegistry } from "../shell/owner";
import { RouteDock } from "../workbench/route-panes";
vi.mock("../chat/chat-shell", () => ({ ChatShell: () => null }));
const tabStore = createChatPageStore({
  registry: appAtomRegistry,
  search: { mode: "threads", patch: async () => {} },
  local: true,
});
vi.mock("../workbench/provider", () => ({
  useWorkbench: () => ({ store: tabStore, threads: [] }),
}));
vi.mock("../navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
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
  expect(createRouteRegistrations().filter((r) => r.spec.route === "families")).toHaveLength(1);
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
    // The constructor seat leaves families to its admitted owner, as the host composition root does.
    registrations: createRouteRegistrations().filter((r) => r.spec.route !== "families"),
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
  const shell = createRouteShell({ ...services, work: door });
  const mount = shell.mount(
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
    shell,
    services: { ...services, work: door },
    route: web.route,
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
          documentMark: { session: "", openId: "", observedSince: null, changedAt: null },
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

// N-03 is intentionally red for the retiring admitted loader; the direct control isolates it.
test.each(["admitted loader", "direct mount"])(
  "N-03 retained Home return through %s preserves Page, Work and journal",
  async (mode) => {
    const scrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = () => {};
    close.push(() => {
      HTMLElement.prototype.scrollTo = scrollTo;
    });
    const f = await fixture();
    f.mount.close();
    let held: import("../shell/admitted-mount").AdmittedMount | undefined;
    let target: import("../shell/admitted-place").PlaceInput["target"];
    // Cached production admission has the same async await boundary as admitFamilies.
    const load = async () => {
      const result = await loadBuiltinRoute("families", builtinRouteStamp("families"));
      if (!result.ok) throw Error("admission failed");
      return result.route;
    };
    const { applicationRouteShell } = await import("../shell/application-route-shell");
    const readings = await import("../shell/readings-hooks");
    const Atom = await import("effect/reactivity/Atom");
    const inventory = {
      state: "ready",
      observation: {
        sessions: [
          {
            sessionId: document.session,
            connected: true,
            openDocuments: [
              {
                openId: document.openId,
                title: "N03",
                address: "C:/Models/N03.rvt",
                isFamilyDocument: false,
              },
            ],
          },
        ],
      },
    };
    vi.spyOn(readings, "readingAtom").mockImplementation(
      (request) =>
        Atom.make<any>((get) => {
          const timer = setTimeout(
            () => get.setSelf(request.kind === "inventory" ? inventory : { state: "absent" }),
            20,
          );
          get.addFinalizer(() => clearTimeout(timer));
          return { state: "absent" };
        }).pipe(Atom.setIdleTTL(0)) as ReturnType<typeof readings.readingAtom>,
    );
    vi.spyOn(readings, "useInventory").mockReturnValue(
      inventory as ReturnType<typeof readings.useInventory>,
    );
    const sourceServices = await import("../shell/source-route-services");
    vi.spyOn(sourceServices, "sourceRouteServices").mockReturnValue(f.services);
    const mounts = await import("../shell/admitted-mount");
    const makeShell = mounts.createRouteShell;
    vi.spyOn(mounts, "createRouteShell").mockImplementation((...args) => {
      const shell = makeShell(...args);
      const mount = shell.mount.bind(shell);
      shell.mount = ((...args: Parameters<typeof mount>) => {
        target = args[1].target;
        held = mount(...args);
        return held;
      }) as typeof shell.mount;
      return shell;
    });
    const ApplicationShell = applicationRouteShell;
    function Tool() {
      const router = useRouter();
      const port = useMemo(() => admittedRouterAddress(router.history), [router]);
      return mode === "admitted loader" ? (
        <AdmittedRouteView load={load} shell={ApplicationShell} />
      ) : (
        <ApplicationShell route={f.route} address={port} />
      );
    }
    const tab = {
      id: "11111111-1111-4111-8111-111111111111",
      route: "families",
      link: "/families",
      at: takenAt,
    };
    sessionStorage.clear();
    function Root() {
      return <RouteDock renderRoute={(body) => body}>{null}</RouteDock>;
    }
    const root = createRootRoute({ component: Root });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/families", component: Tool }),
        createRoute({ getParentRoute: () => root, path: "/", component: () => null }),
      ]),
      history: createMemoryHistory({ initialEntries: [tab.link] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await vi.waitFor(() => expect(held?.workBasis()).toBeTruthy());
    const original = held!;
    await act(async () => {
      expect(original.page.select([{ kind: "scope", id: '["families","draft"]' }] as never).kind).toBe(
        "accepted",
      );
      original.page.pose({ readId: "00000000-0000-4000-8000-000000000001", focus: cell }, "named");
      original.invoke("read", { filter, readId: "00000000-0000-4000-8000-000000000001" });
      f.publish({ kind: "complete", revision: 1, value: f.observation });
      await settled(original.invoke("edit", edit, original.workBasis()!));
    });
    await act(async () => {
      expect(await original.history!.undo()).toMatchObject({ ok: true });
      expect(await original.history!.redo()).toMatchObject({ ok: true });
    });
    const before = {
      target,
      page: original.page.read(),
      work: original.work(),
      journal: original.journal(),
    };
    await act(() => router.navigate({ to: "/" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    screen.getByRole("button", { name: /^Families/ }).click();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/families"));
    await vi.waitFor(() =>
      expect(
        held?.subjectState(Object.fromEntries(new URLSearchParams(router.history.location.search)))
          ?.ready,
      ).toBe(true),
    );
    await vi.waitFor(() => expect(held?.workBasis()).toBeTruthy());
    expect({
      target,
      page: held!.page.read(),
      work: held!.work(),
      journal: held!.journal(),
    }).toEqual(before);
    expect(held).toBe(original);
  },
);
