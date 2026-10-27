// @vitest-environment jsdom
/** Deterministic route proof: fixture transport, real route/page owner, head and the one shell. No ASHRAE tables are served, so nothing is priced. */
import { ChatHosted } from "#/route/situation-ladder";
import { Route } from "#/routes/ducts";
import {
  applyPatches,
  ductsRouteState,
  readingKey,
  readingRequestSchema,
  DUCTS_BODY_VERSION_HEADER,
  DUCTS_REFRESH_HEADER,
  type DuctsReadingRequest,
  emptyThreadHead,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { DuctsSnapshot } from "@pe/host-contracts/generated";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import type { ProtoProps } from "./proto/props";
import { useNativeObservation } from "#/revit/observation";
import { peReadings } from "#/readings";
import { pricingJob, type PricingRequest, type PricingResponse } from "./pricing-job";
import type { ModelPicture } from "./model-picture";
import type { SceneInstance } from "#/scene/types";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { declaredTeaching } from "@pe/kit/lang/teach";
import { useTeaching } from "@pe/kit/lang/use-teach";
import { DUCTS_LAYOUT } from "./proto/e/teaching";

const picture = vi.hoisted(() => ({ current: null as Parameters<typeof ModelPicture>[0] | null }));
vi.mock("./model-picture", async (original) => {
  const module = await original<typeof import("./model-picture")>();
  return {
    ...module,
    ModelPicture: (props: Parameters<typeof ModelPicture>[0]) => {
      picture.current = props;
      return <module.ModelPicture {...props} />;
    },
  };
});

const drawing = vi.hoisted(() => ({ lightweight: false, latest: null as ProtoProps | null }));
const inboxProbe = vi.hoisted(() => ({
  focus: null as Parameters<typeof import("./proto/e/inbox").Inbox>[0]["onFocusCell"] | null,
}));
vi.mock("./proto/e/inbox", async (original) => {
  const module = await original<typeof import("./proto/e/inbox")>();
  return {
    ...module,
    Inbox: (props: Parameters<typeof module.Inbox>[0]) => {
      inboxProbe.focus = props.onFocusCell;
      return <module.Inbox {...props} />;
    },
  };
});
vi.mock("./proto/e/screen", async (original) => {
  const { EScreen } = await original<typeof import("./proto/e/screen")>();
  return {
    EScreen: ({ props }: { props: ProtoProps }) => {
      const observation = useNativeObservation();
      drawing.latest = props;
      return drawing.lightweight ? (
        <div
          data-proto={props.snapshot ? "E2" : undefined}
          data-native={
            observation.scope?.source === "native" && observation.scope.document !== null
          }
        >
          {props.snapshot ? props.snapshot.document.elapsedMs : "reading ducts…"}
          {props.reading.refreshing ? "refreshing…" : ""}
        </div>
      ) : (
        <EScreen props={props} />
      );
    },
  };
});

let work = ductsRouteState.schema.parse({ assumptions: {} });
let revision = 0;
type Request = DuctsSnapshot.Req.Request;
const requests: { request: Request; openId: string | null }[] = [];
const workListeners = new Set<() => void>();
const ductsListeners = new Set<() => void>();
const headListeners = new Set<() => void>();
let head = emptyThreadHead;
const ductReadings = new Map<string, { request: DuctsReadingRequest; version: string }>();
let nextReading = 0;
const ductReading = (request: DuctsReadingRequest) => {
  const key = readingKey(request);
  let value = ductReadings.get(key);
  if (!value) {
    value = { request, version: `duct-route-fixture-${++nextReading}` };
    ductReadings.set(key, value);
  }
  return value;
};
const invalidateDucts = (openId: string) => {
  for (const value of ductReadings.values())
    if (value.request.kind === "ducts-snapshot" && value.request.target.openId === openId)
      value.version = `duct-route-fixture-${++nextReading}`;
  ductsListeners.forEach((emit) => emit());
};
let reply: (request: Request) => Promise<Response>;
const links = [
  [100, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 5],
  [5, 6],
];
const connectors = (id: number) =>
  links
    .filter((pair) => pair.includes(id))
    .map((pair, index) => ({
      index,
      kind: "end" as const,
      point: [id, 0, 0],
      direction: "out" as const,
      shape: "round" as const,
      size: "8 in",
      connectedTo: { elementId: pair.find((other) => other !== id)!, connector: 0 },
    }));
const snapshot: DuctSnapshot = {
  coordinateEncoding: "native-double",
  document: {
    title: "Duct route slice",
    readAt: "2026-09-26T00:00:00Z",
    elapsedMs: 1,
    networkBasedCalculations: false,
  },
  levels: [{ id: 30, name: "Level 1", elevationFt: 0 }],
  groups: [
    {
      id: "g1",
      rootIds: [100],
      classifications: ["Supply Air"],
      systemNames: ["SA"],
      terminalCount: 2,
      elementCount: 6,
      loops: 0,
      issueIds: [],
    },
    {
      id: "g2",
      rootIds: [],
      classifications: [],
      systemNames: [],
      terminalCount: 0,
      elementCount: 1,
      loops: 0,
      issueIds: ["no-root:g2"],
    },
  ],
  nodes: [100, 2, 4, 6].map((id) => ({
    id,
    kind: id === 100 ? "equipment" : id === 2 ? "fitting" : "terminal",
    category: "duct node",
    point: [id === 100 ? 0 : id, 0, 0],
    levelId: 30,
    groupId: id === 100 ? null : "g1",
    systemName: id === 100 ? null : "SA",
    connectors: connectors(id),
    facts: [],
  })),
  segments: [1, 3, 5].map((id) => ({
    id,
    kind: "duct",
    curveKind: "line",
    shape: "round",
    size: "8 in",
    diameterIn: 8,
    lengthFt: 2,
    polyline: [
      [id, 0, 0],
      [id + 1, 0, 0],
    ],
    levelId: 30,
    groupId: "g1",
    systemName: "SA",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: connectors(id),
  })),
  flows: [],
  issues: [
    {
      id: "no-root:g2",
      kind: "no-root",
      elementId: null,
      point: null,
      groupId: "g2",
      note: "no root",
    },
  ],
  layers: [],
  systems: [{ id: 900, name: "SA", classification: "Supply Air", criticalPath: [], sections: [] }],
  slots: {
    fanStatic: "PE_M_Fan_ExternalStaticPressure",
    fanFlow: "PE_M_Fan_AirFlow",
    componentDrop: "Pressure Drop",
    fittingCoefficient: "Pe_C",
    terminalFlow: "PE_M_Grd_AirFlow",
  },
};

// The whole document in one read: a group choice is the page's, never the request's.
const response = (): DuctsSnapshot.Res.Response => snapshot;

const inventory = {
  sessions: [
    {
      connected: true,
      sessionId: "slice",
      openDocumentCount: 1,
      openDocuments: [
        { openId: "doc", title: snapshot.document.title, address: null, isFamilyDocument: false },
      ],
    },
  ],
};

beforeEach(() => {
  drawing.lightweight = false;
  drawing.latest = null;
  inboxProbe.focus = null;
  picture.current = null;
  work = ductsRouteState.schema.parse({ assumptions: {} });
  revision = 0;
  requests.length = 0;
  workListeners.clear();
  ductsListeners.clear();
  ductReadings.clear();
  head = emptyThreadHead;
  headListeners.clear();
  reply = async () => Response.json(response());
  // Fixture transport only: the route still resolves its target and reads through the production wire.
  vi.stubGlobal(
    "EventSource",
    class {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      closed = false;
      constructor(url: string) {
        queueMicrotask(() => {
          if (this.closed) return;
          this.onopen?.();
          const keys: unknown[] = JSON.parse(new URL(url).searchParams.get("keys")!);
          for (const raw of keys) {
            const request = readingRequestSchema.parse(raw);
            const emit = () => {
              const value =
                request.kind === "machine"
                  ? machineFixture(
                      inventory.sessions.map((session) => ({
                        session: session.sessionId,
                        documents: session.openDocuments.map((document) => ({
                          ...document,
                          isActive: document.openId === "doc",
                        })),
                      })),
                    )
                  : request.kind === "inventory"
                    ? inventory
                    : request.kind === "thread-head"
                      ? head
                      : request.kind === "work"
                        ? { doc: work, revision }
                        : request.kind === "ducts-snapshot" || request.kind === "ducts-tables"
                          ? {
                              state: "ready",
                              revision: ductReading(request).version,
                              version: ductReading(request).version,
                              session:
                                request.kind === "ducts-snapshot"
                                  ? request.target.session
                                  : request.session,
                              target: request.kind === "ducts-snapshot" ? request.target : null,
                            }
                          : undefined;
              if (value !== undefined)
                this.onmessage?.({
                  data: JSON.stringify({ kind: "snapshot", key: readingKey(request), value }),
                });
            };
            if (request.kind === "work")
              workListeners.add(() => {
                if (!this.closed) emit();
              });
            if (request.kind === "thread-head")
              headListeners.add(() => {
                if (!this.closed) emit();
              });
            if (request.kind === "ducts-snapshot" || request.kind === "ducts-tables")
              ductsListeners.add(() => {
                if (!this.closed) emit();
              });
            emit();
          }
        });
      }
      close() {
        this.closed = true;
      }
    },
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.startsWith("/pe/scope/") && init?.method === "PUT" && typeof init.body === "string") {
      const { targets } = JSON.parse(init.body) as { targets: ThreadHead["targets"] };
      head = {
        ...head,
        targets: targets.map((target) => ({ ...target, admission: null })),
        revision: head.revision + 1,
      };
      queueMicrotask(() => headListeners.forEach((emit) => emit()));
      return Response.json({
        ok: true,
        why: "set",
        head: {
          ...head,
        },
      });
    }
    if (url.includes("/route-state/ducts/apply") && typeof init?.body === "string") {
      const { patches, expectedRevision } = JSON.parse(init.body);
      const result = applyPatches(
        ductsRouteState,
        { version: 1, revision, doc: work },
        "human",
        patches,
        expectedRevision,
      );
      if (!result.ok) return Response.json(result);
      work = result.envelope.doc;
      revision = result.envelope.revision;
      queueMicrotask(() => workListeners.forEach((emit) => emit()));
      return Response.json({ ok: true, revision });
    }
    if (url === "/call" && typeof init?.body === "string") {
      const { key, request } = JSON.parse(init.body);
      const headers = new Headers(init.headers);
      const session = headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)!;
      const openId = headers.get(HOST_RPC_DOCUMENT_HEADER);
      const subject = readingRequestSchema.parse(
        key === "ducts.snapshot"
          ? { kind: "ducts-snapshot", target: { session, openId }, ...request }
          : { kind: "ducts-tables", session, ids: request.ids },
      ) as DuctsReadingRequest;
      const held = ductReading(subject);
      if (headers.get(DUCTS_REFRESH_HEADER) === held.version) {
        held.version = `duct-route-fixture-${++nextReading}`;
        queueMicrotask(() => ductsListeners.forEach((emit) => emit()));
      }
      const version = held.version;
      if (key === "ducts.snapshot") requests.push({ request, openId });
      const result =
        key === "ducts.snapshot"
          ? await reply(request)
          : Response.json({ tables: {}, missing: [], unsupported: {} });
      if (version !== held.version)
        return Response.json({ error: "Reading invalidated" }, { status: 409 });
      result.headers.set("x-pe-resolved-session", session);
      if (openId) result.headers.set("x-pe-resolved-open-id", encodeURIComponent(openId));
      result.headers.set("x-pe-native-request-id", `native-${version}`);
      result.headers.set(DUCTS_BODY_VERSION_HEADER, version);
      result.headers.set("x-pe-ducts-reused", "true");
      return result;
    }
    throw Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  inventory.sessions[0]!.openDocuments.splice(1);
  vi.unstubAllGlobals();
});

async function mount(
  search = "&system=SA",
  hosted = false,
  target = "slice",
  thread = "fixture",
  nativeRead = true,
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/ducts",
    validateSearch: Route.options.validateSearch,
    component: Route.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/ducts?target=${target}&thread=${thread}${search}`],
    }),
  });
  await router.load();
  // The last test's atoms hold their keys for the registry's idle TTL, so the shared stream would
  // stay on that test's transport and state. Reconnect it onto this one's, as a wake does.
  peReadings.resync();
  const rendered = render(
    <ChatHosted.Provider value={hosted}>
      <RouterProvider router={router} />
    </ChatHosted.Provider>,
  );
  if (nativeRead) await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText("reading ducts…")).toBeNull());
  return { ...rendered, router };
}

test("navigation demo prices the production route and moves all to Office to Lab to all without native authority", async () => {
  drawing.lightweight = true;
  window.history.replaceState({}, "", "/ducts?demo=navigation");
  const flights: PricingRequest[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: ((event: MessageEvent<PricingResponse>) => void) | null = null;
      onerror = null;
      solve = pricingJob();
      postMessage(request: PricingRequest) {
        flights.push(request);
        const data = this.solve(request);
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<PricingResponse>));
      }
      terminate() {}
    },
  );
  try {
    const { router } = await mount("&demo=navigation", false, "slice", "fixture", false);
    await waitFor(() => expect(drawing.latest?.analysis?.systems).toHaveLength(3));
    expect(screen.getByText(/Navigation fixture \(synthetic/)).toBeTruthy();
    expect(drawing.latest?.doc).toBeNull();
    expect(document.querySelector('[data-proto="E2"]')?.getAttribute("data-native")).toBe("false");
    expect(await drawing.latest!.actions.preview.run()).toMatchObject({ code: "not-ready" });
    const epoch = drawing.latest!.page.epoch;
    const before = flights.length;
    fireEvent.click(screen.getByRole("button", { name: /^refresh/, hidden: true }));
    await waitFor(() => expect(drawing.latest!.page.epoch).toBe(epoch + 1));
    await waitFor(() => expect(flights.length).toBeGreaterThan(before));
    await waitFor(() => expect(drawing.latest!.priced).not.toBeNull());
    expect(await drawing.latest!.actions.apply.run()).toMatchObject({ code: "not-ready" });
    for (const system of [
      ["SA Office"],
      ["EA Lab", "SA Office"],
      ["EA Lab", "SA Office", "SA Lab"],
      [],
    ]) {
      act(() => drawing.latest!.setPage({ system, picture: "schematic" }));
      await waitFor(() => expect(router.state.location.search).toMatchObject({ system }));
      expect(drawing.latest?.page.system).toEqual(system);
    }
    expect(requests).toEqual([]);
  } finally {
    cleanup();
    window.history.replaceState({}, "", "/");
  }
}, 30_000);

test("the real workspace composition keeps paired scopes, Inputs folds and programmatic landings", async () => {
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(100, 80, 1200, 800));
  window.history.replaceState({}, "", "/ducts?demo=navigation");
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: ((event: MessageEvent<PricingResponse>) => void) | null = null;
      onerror = null;
      solve = pricingJob();
      postMessage(request: PricingRequest) {
        const data = this.solve(request);
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<PricingResponse>));
      }
      terminate() {}
    },
  );
  function Inventory() {
    return (
      <output data-workspace-inventory="">
        {JSON.stringify(useTeaching().filter((fact) => fact.kind === "region"))}
      </output>
    );
  }
  try {
    const mounted = await mount("&demo=navigation", false, "slice", "fixture", false);
    await waitFor(() => expect(drawing.latest?.priced).not.toBeNull());
    render(<Inventory />);
    const inventory = () =>
      JSON.parse(document.querySelector("[data-workspace-inventory]")!.textContent!);
    const ids = declaredTeaching(DUCTS_LAYOUT)
      .filter((fact) => fact.kind === "region")
      .map((fact) => fact.id)
      .sort();
    expect(ids).toHaveLength(7);
    await waitFor(() =>
      expect(
        inventory()
          .map((fact: { id: string }) => fact.id)
          .sort(),
      ).toEqual(ids),
    );
    expect(inventory().find((fact: { id: string }) => fact.id === "e-inputs")).toMatchObject({
      available: false,
      visibility: "folded",
    });
    const unit = drawing.latest!.snapshot!.nodes.find((node) => node.kind === "equipment")!;
    await waitFor(() => expect(inboxProbe.focus).not.toBeNull());
    act(() => inboxProbe.focus!({ segment: "equipmentFlows", id: unit.id }));
    const split = (id: string) => mounted.container.querySelector(`[data-layout-split="${id}"]`)!;
    await waitFor(() => expect(split("inputs").hasAttribute("data-pane-folded")).toBe(false));
    expect(split("scope-upper").getAttribute("data-pane-folded")).toBe("start");
    expect(split("scope-lower").getAttribute("data-pane-folded")).toBe("start");
    const actual = [...mounted.container.querySelectorAll("[data-pane-id]")]
      .map((node) => node.getAttribute("data-pane-id"))
      .sort();
    expect(actual).toEqual(ids);
    expect(mounted.container.querySelectorAll('[data-pane-id="e-picture"]')).toHaveLength(1);
    const own = scopeOf(drawing.latest!.snapshot!, drawing.latest!.page.system)!;
    const component = drawing.latest!.snapshot!.nodes.find(
      (node) => node.groupId && own.groups.includes(node.groupId),
    )!;
    fireEvent.click(
      within(split("scope-upper") as HTMLElement).getByRole("button", {
        name: "Expand Systems",
        hidden: true,
      }),
    );
    expect(split("scope-upper").getAttribute("data-pane-folded")).toBe("end");
    expect(split("scope-lower").getAttribute("data-pane-folded")).toBe("end");
    act(() => inboxProbe.focus!({ segment: "componentDrops", id: component.id }));
    expect(split("scope-upper").getAttribute("data-pane-folded")).toBe("start");
    expect(split("scope-lower").getAttribute("data-pane-folded")).toBe("start");
    expect(requests).toEqual([]);
  } finally {
    rect.mockRestore();
    cleanup();
  }
}, 30_000);

test("a changed document fences a pending read after changing targets and returning to that exact open document", async () => {
  // Exercise the real route, target and read owners. Tree/layout work cannot falsify this race.
  drawing.lightweight = true;
  inventory.sessions[0]!.openDocuments.push({
    openId: "doc2",
    title: "Second document",
    address: null,
    isFamilyDocument: false,
  });
  const target = encodeURIComponent(
    JSON.stringify({ kind: "open", ref: { session: "slice", openId: "doc" } }),
  );
  const mounted = await mount("&system=SA", false, target, "");
  await waitFor(() => expect(document.querySelector('[data-proto="E2"]')).not.toBeNull());
  const picture = document.querySelector('[data-proto="E2"]');
  expect(picture?.getAttribute("data-native")).toBe("true");
  let release: (value: Response) => void = () => {};
  reply = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  fireEvent.click(screen.getByRole("button", { name: /^refresh/, hidden: true }));
  expect(document.querySelector('[data-proto="E2"]')).not.toBeNull();
  await waitFor(() => expect(requests.length).toBe(2));
  expect(document.querySelector('[data-proto="E2"]')).toBe(picture);
  expect(picture?.closest('[aria-busy="true"]')).not.toBeNull();
  expect(picture?.textContent).toContain("refreshing");
  expect(picture?.getAttribute("data-native")).toBe("false");
  const old = response();
  reply = async () => Response.json(response());
  const pick = async (title: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Choose document", hidden: true }));
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(title), hidden: true }));
  };
  await pick("Second document");
  await waitFor(() => expect(requests.at(-1)?.openId).toBe("doc2"), {
    onTimeout: () =>
      Error(JSON.stringify({ head, search: mounted.router.state.location.search, requests })),
  });
  act(() => invalidateDucts("doc"));
  await pick("Duct route slice");
  await waitFor(() => expect(requests.at(-1)?.openId).toBe("doc"));
  await act(async () =>
    release(Response.json({ ...old, document: { ...old.document, elapsedMs: 999999 } })),
  );
  expect(
    screen.getByRole("region", { name: "Ducts route", hidden: true }).textContent,
  ).not.toContain("999999");
  // Two document-picker transitions and a fenced read exceed 15 s on a busy test machine.
}, 30_000);

test("picture layers choose the shared context mode and remove system colour keys", async () => {
  const instance = { revitId: 1 } as SceneInstance;
  await mount();
  await waitFor(() => expect(picture.current?.contextMode).toBe("halo"));
  expect(picture.current!.paintOf!(instance)).toEqual({
    tier: "subject",
    key: "supply",
    ink: "#0569a5",
  });
  act(() => drawing.latest!.setPage({ layers: ["meshes", "halo", "context"] }));
  await waitFor(() => expect(picture.current?.contextMode).toBe("all"));
  expect(picture.current!.paintOf!(instance)).toEqual({ tier: "subject" });
  act(() => drawing.latest!.setPage({ layers: ["meshes", "halo", "system-colours"] }));
  await waitFor(() => expect(picture.current?.contextMode).toBe("halo"));
  expect(picture.current!.paintOf!(instance)).toEqual({
    tier: "subject",
    key: "supply",
    ink: "#0569a5",
  });
  // Scope mutation cannot depend on rendering an animation frame.
  const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  try {
    fireEvent.click(
      screen
        .getAllByRole("button", { name: 'Remove the "SA active" narrowing', hidden: true })
        .at(-1)!,
    );
    await waitFor(() => expect(drawing.latest!.page.system).toEqual([]));
  } finally {
    frame.mockRestore();
  }
});

test("a native tree selection keeps the camera and address pose; F frames and Escape keeps it", async () => {
  const view = await mount();
  const stretch = view.container.querySelector('[data-e-kind="leg"]')!.closest("[data-key]")!;
  fireEvent.click(stretch.querySelector(".dl-row-twist")!);
  const part = await waitFor(() => {
    const label = view.container.querySelector('[data-e-kind="element"]');
    expect(label).not.toBeNull();
    return label!;
  });
  const id = "1";
  await waitFor(() => expect(picture.current!.orbit.read()).not.toBeNull());
  const pose = picture.current!.orbit.read();
  const viewport = drawing.latest!.page.viewport;
  fireEvent.click(part);
  await waitFor(() => expect(drawing.latest!.page.selected).toBe(id));
  expect(picture.current!.orbit.read()).toEqual(pose);
  expect(drawing.latest!.page.viewport).toEqual(viewport);
  expect(new URLSearchParams(view.router.state.location.searchStr).get("viewport")).toBe("null");
  fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
  await waitFor(() => expect(drawing.latest!.page.viewport).not.toBeNull());
  expect(picture.current!.orbit.read()).not.toEqual(pose);
  const framed = picture.current!.orbit.read();
  fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(drawing.latest!.page.selected).toBe(""));
  expect(picture.current!.orbit.read()).toEqual(framed);
});

test("a edit subject and plural claim select the whole row without framing; a verdict stages the claim", async () => {
  work = ductsRouteState.schema.parse({
    subject: { g1: { edit: { value: [100, 1, 2, 3, 4] } } },
    claims: {
      c1: {
        edit: {
          value: {
            title: "Open ends",
            text: "Open ends at 1 and 3.",
            ids: [1, 3],
            state: "assumed",
          },
        },
      },
    },
    labelParameter: { edit: { value: "Unit Tag" } },
  });
  reply = async () =>
    Response.json({
      ...response(),
      nodes: snapshot.nodes.map((node) => (node.id === 100 ? { ...node, label: "AHU-9" } : node)),
    });
  await mount();
  // The edit labelParameter rides the snapshot request.
  await waitFor(() => expect(requests.at(-1)?.request).toEqual({ labelParameter: "Unit Tag" }));
  // A person reveals the folded pane before acting on its evidence.
  fireEvent.click(await screen.findByRole("button", { name: /^Expand Rulings/ }));
  const inbox = await screen.findByText("Check");
  expect(inbox).toBeTruthy();
  const prefix = await waitFor(() => {
    const row = document.querySelector<HTMLElement>('[data-key="claim:c1"]');
    expect(row, document.querySelector("#e-inbox")?.textContent ?? "no inbox").not.toBeNull();
    return row!;
  });
  const pose = picture.current!.orbit.read();
  fireEvent.click(within(prefix).getByText("Open ends"));
  await waitFor(() => expect([...picture.current!.selected]).toEqual([1, 3]));
  expect(picture.current!.orbit.read()).toEqual(pose);
  expect(drawing.latest!.page.viewport).toBeNull();
  expect(drawing.latest!.page).toMatchObject({ selected: "", issue: "claim:c1" });
  const detail = document.querySelector<HTMLElement>('[data-inbox-detail="claim:c1"]')!;
  fireEvent.focus(within(detail).getByRole("button", { name: "What is this?" }));
  const evidence = await screen.findByRole("tooltip");
  fireEvent.click(evidence.querySelector('[data-claim-element="1"]')!);
  await waitFor(() => expect(drawing.latest!.page.viewport).not.toBeNull());
  expect(drawing.latest!.page.selected).toBe("1");
  fireEvent.click(await screen.findByRole("button", { name: "yes" }));
  await waitFor(() => expect(work.claims.c1?.edit?.value?.verdict).toBe("yes"));
  expect(work.claims.c1?.edit?.value).toMatchObject({
    title: "Open ends",
    text: "Open ends at 1 and 3.",
    ids: [1, 3],
  });
  expect(work.claims.c1!.edit!.value).not.toHaveProperty("verdictBy");
  expect(work.claims.c1!.edit!.value).not.toHaveProperty("verdictAt");
}, 20000);
