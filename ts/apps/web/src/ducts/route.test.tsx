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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";

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

async function mount(search = "&system=SA", hosted = false, target = "slice", thread = "fixture") {
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

test("a changed document fences a pending read after changing targets and returning to that exact open document", async () => {
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
  expect(screen.getByRole("region", { name: "Ducts route" }).textContent).not.toContain("999999");
});

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
  // No group chosen: the inbox holds every claim, and a row opens on a press.
  await mount("");
  // The staged labelParameter rides the snapshot request.
  await waitFor(() => expect(requests.at(-1)?.request).toEqual({ labelParameter: "Unit Tag" }));
  const inbox = await screen.findByText("Check");
  expect(inbox).toBeTruthy();
  fireEvent.click(await screen.findByText(/The unit is/));
  fireEvent.click(await screen.findByRole("button", { name: "yes" }));
  await waitFor(() => expect(work.claims.c1?.staged?.value?.verdict).toBe("yes"));
  expect(work.claims.c1?.staged?.value).toMatchObject({
    text: "The unit is AHU-9.",
    ids: [100],
    verdictBy: "person",
  });
  expect(Date.parse(work.claims.c1!.staged!.value!.verdictAt!)).not.toBeNaN();
}, 20000);
