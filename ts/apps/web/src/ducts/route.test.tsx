// @vitest-environment jsdom
/** Deterministic route proof: fixture transport, real route/page owner, head and all five views. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  applyPatches,
  ductsRouteState,
  readingKey,
  readingRequestSchema,
} from "@pe/agent-contracts";
import { Route } from "#/routes/ducts";
import { ChatHosted } from "#/route/situation-ladder";
import type { DuctsSnapshot } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "./readiness";

let work = ductsRouteState.schema.parse({ assumptions: {} });
let revision = 0;
type Request = DuctsSnapshot.Req.Request;
const requests: { request: Request; openId: string | null }[] = [];
const workListeners = new Set<() => void>();
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
  group: "g1",
  document: { title: "Duct route slice", readAt: "2026-09-26T00:00:00Z", elapsedMs: 1 },
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
      rootNames: [],
      segmentCount: 0,
      designCfm: 0,
      issueCounts: [],
    },
    {
      id: "g2",
      rootIds: [],
      rootNames: [],
      classifications: [],
      systemNames: [],
      terminalCount: 0,
      elementCount: 1,
      segmentCount: 1,
      designCfm: 0,
      loops: 0,
      issueCounts: [{ kind: "no-root", count: 1, open: 1 }],
    },
  ],
  nodes: [100, 2, 4, 6].map((id) => ({
    id,
    kind: id === 100 ? "equipment" : id === 2 ? "fitting" : "terminal",
    category: "duct node",
    point: [id === 100 ? 0 : id, 0, 0],
    levelId: 30,
    groupId: id === 100 ? null : "g1",
    connectors: connectors(id),
    facts: [],
  })),
  segments: [1, 3, 5].map((id) => ({
    id,
    kind: "duct",
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
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: connectors(id),
  })),
  flows: [],
  issues: [],
  layers: [],
};

const response = (request: Request): DuctsSnapshot.Res.Response => ({
  document: snapshot.document,
  groups: snapshot.groups,
  levels: snapshot.levels,
  layers: [],
  assumptionRevision: request.assumptions?.revision,
  context: [
    {
      levelId: 30,
      polylines: [
        [
          [0, 20, 0],
          [20, 20, 0],
        ],
      ],
    },
  ],
  ...(request.group
    ? {
        group: request.group,
        nodes: request.group === "g1" ? snapshot.nodes : [],
        segments: request.group === "g1" ? snapshot.segments : [],
        flows: [],
        issues: [],
        pressure: {
          assumptionRevision: request.assumptions?.revision,
          segments: [],
          fittings: [],
          terminals: [],
          groups: [],
          issues: [],
          assumptionsUsed: [],
        },
      }
    : {}),
});

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
  work = ductsRouteState.schema.parse({ assumptions: {} });
  revision = 0;
  requests.length = 0;
  workListeners.clear();
  reply = async (request) => Response.json(response(request));
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
                request.kind === "inventory"
                  ? inventory
                  : request.kind === "work"
                    ? { doc: work, revision }
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
    if (
      url === "/call" &&
      typeof init?.body === "string" &&
      JSON.parse(init.body).key === "ducts.snapshot"
    ) {
      const request = JSON.parse(init.body).request as Request;
      requests.push({ request, openId: new Headers(init.headers).get("x-pe-open-document-id") });
      return reply(request);
    }
    throw Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
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
  inventory.sessions[0]!.openDocuments.splice(1);
  vi.unstubAllGlobals();
});

async function mount(
  search = "&group=g1&view=iso",
  hosted = false,
  target = "slice",
  thread = "fixture",
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
  const rendered = render(
    <ChatHosted.Provider value={hosted}>
      <RouterProvider router={router} />
    </ChatHosted.Provider>,
  );
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText("reading ducts…")).toBeNull());
  return { ...rendered, router };
}

async function view(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Choose view" }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(label) }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

test("the route sentence, refresh and every view mount from the same snapshot", async () => {
  const { container, router } = await mount();
  const head = screen.getByRole("region", { name: "Ducts route" });
  expect(head.textContent).toContain("Surveying ducts");
  expect(head.textContent).toContain("g1 (Supply Air)");
  expect(head.textContent).toContain("an isometric");
  expect(within(head).getByRole("button", { name: /^refresh/ })).toBeTruthy();
  for (const [label, selector] of [
    ["tables", 'table[aria-label="duct segments"]'],
    ["tree", "[data-vertex]"],
    ["ledger", 'table[aria-label="duct runs"]'],
    ["a plan", '[data-ducts-drawing="plan"]'],
    ["an isometric", '[data-ducts-drawing="isometric"]'],
  ]) {
    await view(label!);
    await waitFor(() => expect(container.querySelector(selector!)).not.toBeNull());
  }
  expect(router.state.location.search.group).toBe("g1");
}, 20000);

test("document reads an index with context; group picks, clear and refresh each read their scope", async () => {
  const { container, router } = await mount("&view=iso");
  expect(requests.at(-1)?.request).toEqual({
    context: true,
    assumptions: { revision: 0, values: {} },
  });
  expect(container.querySelector("[data-segment]")).toBeNull();
  expect(container.querySelector("[data-context]")).not.toBeNull();
  await view("ledger");
  expect(screen.getByLabelText("duct groups ledger").textContent).toContain("no root");
  fireEvent.click(
    within(screen.getByLabelText("duct groups ledger")).getByText("g1").closest("tr")!,
  );
  await waitFor(() => expect(requests.at(-1)?.request.group).toBe("g1"));
  await waitFor(() => expect(screen.getByLabelText("duct runs").textContent).toContain("4"));
  fireEvent.click(
    within(screen.getByLabelText("duct groups ledger")).getByText("g1").closest("tr")!,
  );
  await waitFor(() => expect(router.state.location.search.group ?? "").toBe(""));
  await waitFor(() => expect(requests.at(-1)?.request.group).toBeUndefined());
  const count = requests.length;
  fireEvent.click(screen.getByRole("button", { name: /^refresh/ }));
  await waitFor(() => expect(requests.length).toBe(count + 1));
  expect(requests.at(-1)?.request.group).toBeUndefined();
});

test("a Work revision reads staged values only and fences an older response", async () => {
  const { container } = await mount();
  let release: (value: Response) => void = () => {};
  reply = (request) =>
    request.assumptions?.revision === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(Response.json(response(request)));
  work = ductsRouteState.schema.parse({
    assumptions: {
      "fan-static:100": { staged: { value: { kind: "fan-static", inWg: 0.5 } } },
      "component-drop:AHU": { proposal: { value: { kind: "component-drop", inWg: 0.1 } } },
    },
  });
  act(() => {
    revision = 1;
    workListeners.forEach((emit) => emit());
  });
  await waitFor(() =>
    expect(requests.at(-1)?.request.assumptions).toEqual({
      revision: 1,
      values: { "fan-static:100": { kind: "fan-static", inWg: 0.5 } },
    }),
  );
  const old = response(requests.at(-1)!.request);
  act(() => {
    revision = 2;
    workListeners.forEach((emit) => emit());
  });
  await waitFor(() => expect(requests.at(-1)?.request.assumptions?.revision).toBe(2));
  await waitFor(() => expect(container.querySelector('[data-segment="3"]')).not.toBeNull());
  await act(async () =>
    release(Response.json({ ...old, document: { ...old.document, elapsedMs: 999999 } })),
  );
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).not.toContain("999999");
});

test("staging fan static through the ledger changes the request and the pressure budget readout", async () => {
  work = ductsRouteState.schema.parse({
    assumptions: {
      "fan-static:100": { proposal: { value: { kind: "fan-static", inWg: 0.9 } } },
    },
  });
  reply = async (request) => {
    const result = response(request);
    const fan = request.assumptions?.values["fan-static:100"]?.inWg;
    if (result.pressure) {
      result.pressure.assumptionsUsed = [
        {
          id: "fan:100",
          value: fan == null ? "unknown" : String(fan),
          source: fan == null ? "Default" : "User",
          reason: "staged Work fan rating",
        },
      ];
      result.pressure.groups = [
        {
          groupId: "g1",
          isWalkable: true,
          criticalPathIncludesComponents: true,
          assumptionsUsed: ["fan:100"],
          totalEffectiveLengthFt: 200,
          availableStaticInWg: fan == null ? null : fan - 0.1,
          frictionRateInWgPer100Ft: fan == null ? null : (fan - 0.1) / 2,
          marginInWg: fan == null ? null : fan - 0.3,
        },
      ];
    }
    return Response.json(result);
  };
  await mount("&group=g1&view=ledger");
  expect(screen.getByRole("button", { name: /^available static: unknown/ })).toBeTruthy();
  expect(requests.at(-1)!.request.assumptions?.values).toEqual({});
  const input = screen.getByRole("spinbutton", { name: "fan-static:100" });
  fireEvent.change(input, { target: { value: "0.5" } });
  fireEvent.click(
    within(input.closest("[data-assumption]") as HTMLElement).getByRole("button", {
      name: "stage",
    }),
  );
  await waitFor(() =>
    expect(requests.at(-1)!.request.assumptions).toEqual({
      revision: 1,
      values: { "fan-static:100": { kind: "fan-static", inWg: 0.5 } },
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^available static: 0.400/ })).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: /^friction rate: 0.200/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^margin: 0.200/ })).toBeTruthy();
  expect(work.assumptions["fan-static:100"]?.proposal?.value).toEqual({
    kind: "fan-static",
    inWg: 0.9,
  });
});

test("a group change fences late geometry and the hosted sentence names its document", async () => {
  const { container } = await mount("&view=ledger", true);
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).toContain(
    "on Duct route slice",
  );
  expect(container.querySelectorAll('[data-axis="horizontal"]')).toHaveLength(0);
  let release: (value: Response) => void = () => {};
  reply = (request) =>
    request.group === "g1"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(Response.json(response(request)));
  fireEvent.click(
    within(screen.getByLabelText("duct groups ledger")).getByText("g1").closest("tr")!,
  );
  await waitFor(() => expect(requests.at(-1)?.request.group).toBe("g1"));
  const old = response(requests.at(-1)!.request);
  fireEvent.click(
    within(screen.getByLabelText("duct groups ledger")).getByText("g2").closest("tr")!,
  );
  await waitFor(() => expect(requests.at(-1)?.request.group).toBe("g2"));
  await act(async () =>
    release(Response.json({ ...old, document: { ...old.document, elapsedMs: 999999 } })),
  );
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).not.toContain("999999");
  expect(screen.getByLabelText("duct runs").querySelector("[data-active]")).toBeNull();
});

test("an exact document lifetime change fences a pending read, including returning to the first document", async () => {
  inventory.sessions[0]!.openDocuments.push({
    openId: "doc2",
    title: "Second document",
    address: null,
    isFamilyDocument: false,
  });
  const target = encodeURIComponent(
    JSON.stringify({ kind: "open", ref: { session: "slice", openId: "doc" } }),
  );
  await mount("&group=g1&view=ledger", false, target, "");
  let release: (value: Response) => void = () => {};
  reply = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  fireEvent.click(screen.getByRole("button", { name: /^refresh/ }));
  await waitFor(() => expect(requests.length).toBe(2));
  const old = response(requests.at(-1)!.request);
  reply = async (request) => Response.json(response(request));
  const pick = async (title: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Choose document" }));
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(title) }));
  };
  await pick("Second document");
  await waitFor(() => expect(requests.at(-1)?.openId).toBe("doc2"));
  await pick("Duct route slice");
  await waitFor(() => expect(requests.at(-1)?.openId).toBe("doc"));
  await act(async () =>
    release(Response.json({ ...old, document: { ...old.document, elapsedMs: 999999 } })),
  );
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).not.toContain("999999");
});

test("page selection follows iso to tables and ledger, and a ledger run lights plan and iso", async () => {
  const { container, router } = await mount();
  fireEvent.click(container.querySelector('[data-segment="3"] path:last-child')!);
  await waitFor(() => expect(router.state.location.search.selected).toBe("3"));
  await view("tables");
  expect(
    screen.getByLabelText("duct segments").querySelector("[data-active]")?.textContent,
  ).toContain("3");
  await view("ledger");
  const runs = screen.getByLabelText("duct runs");
  expect(runs.querySelector("[data-active]")?.textContent).toContain("4");
  fireEvent.click(within(runs).getByText("6").closest("tr")!);
  await waitFor(() => expect(router.state.location.search.selected).toBe("6"));
  for (const label of ["a plan", "an isometric"]) {
    await view(label);
    const lit = [...container.querySelectorAll("[data-segment][data-selected]")].map((el) =>
      el.getAttribute("data-segment"),
    );
    expect(lit).toEqual(["1", "5"]);
    expect(container.querySelector('[data-node-id="6"][data-selected]')).not.toBeNull();
  }
}, 20000);
