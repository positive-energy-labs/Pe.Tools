// @vitest-environment jsdom
/** Deterministic route proof: fixture transport, real route/page owner, head and the views that need no tables. */
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
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";

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
  systems: [],
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
  work = ductsRouteState.schema.parse({ assumptions: {} });
  revision = 0;
  requests.length = 0;
  workListeners.clear();
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
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${label}`) }));
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

test("the read names the document only; a group pick or clear does not read again, refresh does", async () => {
  const { container, router } = await mount("&view=iso");
  expect(requests.at(-1)?.request).toEqual({});
  expect(container.querySelector("[data-segment]")).toBeNull();
  expect(container.querySelector("[data-context]")).not.toBeNull();
  await view("ledger");
  expect(screen.getByLabelText("duct groups ledger").textContent).toContain("no root");
  const count = requests.length;
  const g1 = () =>
    within(screen.getByLabelText("duct groups ledger")).getByText("g1").closest("tr")!;
  fireEvent.click(g1());
  await waitFor(() => expect(router.state.location.search.group).toBe("g1"));
  await waitFor(() => expect(screen.getByLabelText("duct runs").textContent).toContain("4"));
  fireEvent.click(g1());
  await waitFor(() => expect(router.state.location.search.group ?? "").toBe(""));
  expect(requests.length).toBe(count);
  fireEvent.click(screen.getByRole("button", { name: /^refresh/ }));
  await waitFor(() => expect(requests.length).toBe(count + 1));
});

test("the hosted sentence names its document and the ledger stacks its panes", async () => {
  const { container } = await mount("&view=ledger", true);
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).toContain(
    "on Duct route slice",
  );
  expect(container.querySelectorAll('[data-axis="horizontal"]')).toHaveLength(0);
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
  const old = response();
  reply = async () => Response.json(response());
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
  await waitFor(() =>
    expect(container.querySelector('[data-segment="3"] path:last-child')).not.toBeNull(),
  );
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

test("a staged subject, claims and labelParameter render the subject scene; a verdict press stages the claim", async () => {
  work = ductsRouteState.schema.parse({
    subject: { g1: { staged: { value: [100, 1, 2, 3, 4] } } },
    claims: {
      c1: { staged: { value: { text: "The unit is AHU-9.", ids: [100], state: "assumed" } } },
    },
    labelParameter: { staged: { value: "Unit Tag" } },
  });
  reply = async () =>
    Response.json({
      ...response(),
      nodes: snapshot.nodes.map((node) => (node.id === 100 ? { ...node, label: "AHU-9" } : node)),
    });
  const { container } = await mount("&group=g1&view=iso&scene=subject");
  // The staged labelParameter rides the snapshot request.
  await waitFor(() => expect(requests.at(-1)?.request).toEqual({ labelParameter: "Unit Tag" }));
  // The claims cell is the list; the node's label is the place's name in it.
  const row = await waitFor(() => {
    const found = container.querySelector('[data-claim-row="c1"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(row.textContent).toContain("The unit is AHU-9.");
  expect(row.textContent).toContain("at AHU-9");
  expect(container.querySelector("[data-subject]")).not.toBeNull();
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "yes" }));
  await waitFor(() => expect(work.claims.c1?.staged?.value?.verdict).toBe("yes"));
  expect(work.claims.c1?.staged?.value).toMatchObject({
    text: "The unit is AHU-9.",
    ids: [100],
    verdictBy: "person",
  });
  expect(Date.parse(work.claims.c1!.staged!.value!.verdictAt!)).not.toBeNaN();
}, 20000);
