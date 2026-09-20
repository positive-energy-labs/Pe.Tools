// @vitest-environment jsdom
/**
 * The adopt pane lists the host's `takeoffs.candidates` for the chosen views (hold 4a, D4): live,
 * it read `snapshot.zoneFrs`, which holds only regions already stamped, so a drawn zoning plan
 * said "no filled regions" and nothing could be adopted through the UI. Its own file: a mount in
 * another test's registry would be answered by that test's retained Readings.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  address,
  applyPatches,
  readingKey,
  takeoffsRouteState,
  type ReadingRequest,
  type RouteStatePatch,
} from "@pe/agent-contracts";

const calls = vi.hoisted(() => [] as { key: string; request: unknown }[]);
/** What the host answers `takeoffs.candidates` with: regions, none, or an error. */
const answer = vi.hoisted(() => ({ mode: "regions" as "regions" | "none" | "error" }));
/** How many view lanes share each level label (live projectA: dozens of views per level). */
const lanesPerLevel = vi.hoisted(() => ({ n: 1 }));
vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  callHostRpc: async (key: string, request: unknown) => {
    calls.push({ key, request });
    if (key === "takeoffs.candidates" && answer.mode === "error")
      throw new Error("no answer after 120s");
    if (key === "takeoffs.candidates" && answer.mode === "none") return { regions: [] };
    if (key === "takeoffs.candidates")
      return {
        regions: [
          {
            elementId: 5852816,
            typeName: "Zone Fill",
            view: (request as { view: string }).view,
            color: "200,120,40",
            sqft: 812,
            blob: "",
            loops: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
              ],
            ],
          },
        ],
      };
    throw new Error(`no host in test: ${key}`);
  },
  callHostDynamic: () => Promise.reject(new Error("no host in test")),
}));
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { takeoffSeeds } from "#/takeoff/actions";
import { TakeoffsRoute } from "#/takeoff/route";

const SESSION = "session-takeoffs-candidates";
const REF = { session: SESSION, openId: "open-1" };
const AT = address("C:\\Models\\projectA.rvt");
const seeded = (
  takeoffSeeds.adopt as unknown as {
    readings: {
      snapshot: { capture: { snapshot: { world: { lanes: { view: string; label: string }[] } } } };
    };
  }
).readings.snapshot.capture.snapshot;
const VIEW = seeded.world.lanes[0]!.view;

/** The snapshot as live reads it: each level's lane repeated once per view on that level. */
const liveSnapshot = () => {
  const lanes = seeded.world.lanes.flatMap((lane) =>
    Array.from({ length: lanesPerLevel.n }, (_, i) =>
      i === 0 ? lane : { ...lane, view: `${lane.view} (copy ${i})` },
    ),
  );
  // Live: zoneFrs holds only zones already stamped; none are, yet.
  return { ...seeded, world: { ...seeded.world, lanes }, zoneFrs: [] };
};
const takeoffReading = () => ({
  kind: "ready",
  target: REF,
  capture: {
    id: "1".repeat(64),
    capturedAt: "2026-09-19T03:40:00.000Z",
    provenance: { kind: "live", target: REF },
    snapshot: liveSnapshot(),
  },
});
/** The Work the host holds; a landed write is pushed back on the wire, as the host does. */
let work = { version: 1 as const, revision: 1, doc: takeoffsRouteState.schema.parse({}) };
const wires = new Set<WireSource>();
const push = (kind: ReadingRequest["kind"], value: unknown) => {
  for (const wire of wires)
    for (const request of wire.keys.filter((r) => r.kind === kind))
      wire.onmessage?.({
        data: JSON.stringify({ kind: "snapshot", key: readingKey(request), value }),
      });
};

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  keys: ReadingRequest[];
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    this.keys = keys;
    wires.add(this);
    for (const request of keys) {
      const key = readingKey(request);
      const value =
        request.kind === "inventory"
          ? {
              sessions: [
                {
                  connected: true,
                  sessionId: SESSION,
                  openDocumentCount: 1,
                  openDocuments: [
                    { openId: "open-1", title: "project-a", address: AT, isFamilyDocument: false },
                  ],
                },
              ],
            }
          : request.kind === "work"
            ? work
            : request.kind === "takeoff-reading"
              ? takeoffReading()
              : undefined;
      if (value !== undefined)
        setTimeout(
          () => this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) }),
          0,
        );
    }
  }
  close() {
    wires.delete(this);
  }
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

async function mountAndChooseView() {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <TakeoffsRoute target={AT} /> }),
    history: createMemoryHistory({
      initialEntries: [`/takeoffs?target=${encodeURIComponent(AT)}`],
    }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const trigger = await screen.findByRole("button", { name: "Choose views" }, { timeout: 5_000 });
  await act(async () => fireEvent.click(trigger));
  const search = await screen.findByLabelText("Choose views search");
  await act(async () => fireEvent.change(search, { target: { value: VIEW } }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  return view;
}

test("the adopt pane lists takeoffs.candidates for the chosen view, and a tick stages an adopt cell", async () => {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true, revision: 2 }));
  });
  const mounted = await mountAndChooseView();
  const tick = await screen.findByLabelText(`Select Zone Fill in ${VIEW}`, undefined, {
    timeout: 5_000,
  });
  expect(calls).toContainEqual({ key: "takeoffs.candidates", request: { view: VIEW } });
  expect(document.body.textContent).not.toMatch(/no filled regions/i);

  await act(async () => fireEvent.click(tick));
  await waitFor(() =>
    expect(JSON.stringify(posts.map((post) => post.body))).toContain(
      JSON.stringify(["adopt", `${VIEW}:5852816`, "staged"]),
    ),
  );
  vi.unstubAllGlobals();
  mounted.unmount();
}, 60_000); // a whole-route mount

test("the pane says why it lists nothing: no regions on the plan, or the read unanswered", async () => {
  answer.mode = "none";
  let mounted = await mountAndChooseView();
  await screen.findByText(
    "no filled regions on this plan: initialize the zoning plan in Revit",
    undefined,
    { timeout: 5_000 },
  );
  mounted.unmount();
  answer.mode = "error";
  mounted = await mountAndChooseView();
  await screen.findByText("candidates unread", undefined, { timeout: 5_000 });
  expect(document.body.textContent).toContain("no answer after 120s");
  mounted.unmount();
}, 60_000); // two whole-route mounts

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  lanesPerLevel.n = 1;
});

/* ── 29: the rail says each level once; the adopt pane writes on commit; the stamp adopts ── */

test("a reading of N levels and M zones draws N level tabs and M zone rows, also after a re-read", async () => {
  lanesPerLevel.n = 3;
  answer.mode = "regions";
  const mounted = await mountAndChooseView();
  const levels = new Set(seeded.world.lanes.map((lane) => lane.label)).size;
  const zones = (seeded.world as unknown as { zones: unknown[] }).zones.length;
  const tabs = () => screen.getByRole("group", { name: "level" }).querySelectorAll("button").length;
  const rows = () =>
    screen.getByRole("listbox", { name: "zones" }).querySelectorAll("[role=option]").length;
  await waitFor(() => expect(tabs()).toBe(levels), { timeout: 5_000 });
  expect(rows()).toBe(zones);
  await act(async () => push("takeoff-reading", takeoffReading()));
  expect(tabs()).toBe(levels);
  expect(rows()).toBe(zones);
  lanesPerLevel.n = 1;
  mounted.unmount();
}, 60_000);

/** Fresh Work, pushed on the wire: the registry keeps an earlier mount's Work reading open. */
const freshWork = () => {
  work = { ...work, revision: work.revision + 1, doc: takeoffsRouteState.schema.parse({}) };
  push("work", work);
};

/** Stubs fetch as the host: a route write lands on `work` and is pushed back on the wire. */
function hostFetch() {
  const posts: { url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    if (init?.method === "POST") posts.push({ url, body });
    if (body && Array.isArray(body.patches)) {
      const landed = applyPatches(
        takeoffsRouteState,
        work,
        "human",
        body.patches as RouteStatePatch[],
        body.expectedRevision as number,
      );
      if ("envelope" in landed) {
        work = landed.envelope as typeof work;
        setTimeout(() => push("work", work), 0);
      }
    }
    return new Response(JSON.stringify({ ok: true, revision: work.revision }));
  });
  return { writes: () => posts.filter((post) => Array.isArray(post.body?.patches)), posts };
}

test("typing a system tag writes Work once, on commit, never per keystroke", async () => {
  const host = hostFetch();
  const mounted = await mountAndChooseView();
  freshWork();
  const tag = await screen.findByLabelText(`System tag for region 5852816 in ${VIEW}`, undefined, {
    timeout: 5_000,
  });
  for (const typed of ["H", "HP", "HP-", "HP-1"])
    await act(async () => fireEvent.change(tag, { target: { value: typed } }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(host.writes()).toHaveLength(0);
  await act(async () => fireEvent.blur(tag));
  await waitFor(() => expect(host.writes()).toHaveLength(1));
  vi.unstubAllGlobals();
  mounted.unmount();
}, 60_000);

test("ticking a candidate enables the stamp, and pressing it posts takeoffs.adopt with that region", async () => {
  const host = hostFetch();
  const mounted = await mountAndChooseView();
  freshWork();
  const tick = await screen.findByLabelText(`Select Zone Fill in ${VIEW}`, undefined, {
    timeout: 5_000,
  });
  const stamp = () => screen.getByRole("button", { name: /^stamp \d+ as zoning regions$/ });
  // A disabled commit stays focusable (its reason shows on hover and focus): aria-disabled.
  expect(stamp().getAttribute("aria-disabled")).toBe("true");
  await act(async () => fireEvent.click(tick));
  const tag = screen.getByLabelText(`System tag for region 5852816 in ${VIEW}`);
  await act(async () => fireEvent.change(tag, { target: { value: "HP-1" } }));
  await act(async () => fireEvent.blur(tag));
  await waitFor(() => expect(stamp().getAttribute("aria-disabled")).toBeNull(), { timeout: 5_000 });
  expect(stamp().textContent).toBe("stamp 1 as zoning regions");
  await act(async () => fireEvent.click(stamp()));
  const admission = () => host.posts.find((post) => post.url.endsWith("/actions"))?.body;
  await waitFor(() => expect(JSON.stringify(admission())).toContain("takeoffs.adopt"));
  expect(JSON.stringify(admission())).toContain(
    JSON.stringify({
      view: VIEW,
      items: [{ elementId: 5852816, name: "Zone Fill", systemTag: "HP-1" }],
    }),
  );
  vi.unstubAllGlobals();
  mounted.unmount();
}, 60_000);
