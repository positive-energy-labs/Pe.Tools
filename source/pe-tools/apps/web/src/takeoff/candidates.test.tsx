// @vitest-environment jsdom
/**
 * The adopt pane lists the host's `takeoffs.candidates` for the chosen views (hold 4a, D4): live,
 * it read `snapshot.zoneFrs`, which holds only regions already stamped, so a drawn zoning plan
 * said "no filled regions" and nothing could be adopted through the UI. Its own file: a mount in
 * another test's registry would be answered by that test's retained Readings.
 */
import { expect, test, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { address, readingKey, takeoffsRouteState, type ReadingRequest } from "@pe/agent-contracts";

const calls = vi.hoisted(() => [] as { key: string; request: unknown }[]);
/** What the host answers `takeoffs.candidates` with: regions, none, or an error. */
const answer = vi.hoisted(() => ({ mode: "regions" as "regions" | "none" | "error" }));
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
    readings: { snapshot: { capture: { snapshot: { world: { lanes: { view: string }[] } } } } };
  }
).readings.snapshot.capture.snapshot;
const VIEW = seeded.world.lanes[0]!.view;

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
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
            ? { revision: 1, doc: takeoffsRouteState.schema.parse({}) }
            : request.kind === "takeoff-reading"
              ? {
                  kind: "ready",
                  target: REF,
                  capture: {
                    id: "1".repeat(64),
                    capturedAt: "2026-09-19T03:40:00.000Z",
                    provenance: { kind: "live", target: REF },
                    // Live: zoneFrs holds only zones already stamped; none are, yet.
                    snapshot: { ...seeded, zoneFrs: [] },
                  },
                }
              : undefined;
      if (value !== undefined)
        setTimeout(
          () => this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) }),
          0,
        );
    }
  }
  close() {}
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
}, 30_000);

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
