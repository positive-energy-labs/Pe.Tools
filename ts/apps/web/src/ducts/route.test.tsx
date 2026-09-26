// @vitest-environment jsdom
/** Deterministic route proof: fixture transport, real route/page owner, head and all five views. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ductsRouteState, readingKey, readingRequestSchema } from "@pe/agent-contracts";
import { Route } from "#/routes/ducts";
import type { DuctSnapshot } from "./readiness";

const work = ductsRouteState.schema.parse({ assumptions: {} });
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
      issueIds: [],
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
            const value =
              request.kind === "inventory"
                ? inventory
                : request.kind === "work"
                  ? { doc: work, revision: 0 }
                  : undefined;
            if (value !== undefined)
              this.onmessage?.({
                data: JSON.stringify({ kind: "snapshot", key: readingKey(request), value }),
              });
          }
        });
      }
      close() {
        this.closed = true;
      }
    },
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (
      url === "/call" &&
      typeof init?.body === "string" &&
      JSON.parse(init.body).key === "ducts.snapshot"
    )
      return Response.json(snapshot);
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
  vi.unstubAllGlobals();
});

async function mount() {
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
      initialEntries: ["/ducts?target=slice&thread=fixture&group=g1&view=iso"],
    }),
  });
  await router.load();
  const rendered = render(<RouterProvider router={router} />);
  await waitFor(() =>
    expect(rendered.container.querySelector('[data-segment="3"]')).not.toBeNull(),
  );
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
