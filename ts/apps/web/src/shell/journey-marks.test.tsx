// @vitest-environment jsdom
// Slice 6.1: a pane's busy mark derives from the reading the kernel holds; a route never sets it.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { Activity } from "react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { roomsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { module } from "../rooms/route";
import { DEMO_ROOMS } from "../rooms/demo";
import { scrollBody } from "../route/body";
import { mountTypedRoute } from "./typed-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { TypedChrome } from "./typed-shell";
import { settled } from "../test-journey";
import type { UseSource } from "./source-contract";
import { route } from "../route/typed-route";
import { RouteVisibility } from "../route/activity";

const call = vi.hoisted(() => vi.fn(async (door: unknown, ..._: unknown[]) => (door === "view.publish" ? { revision: 1 } : {})));
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));
const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
const roomsProbe = (spec: Partial<typeof module.spec> = {}) =>
  route({ ...module.spec, ...spec, panes: { main: { ...module.spec.panes.main, body: "scroll" as const, draw: () => scrollBody(<p>Rooms body</p>) } } });
/** A Place's mount over a held rooms read: `frames` collects each read's deliver. */
function held(typed: ReturnType<typeof roomsProbe>, frames: Parameters<UseSource["open"]>[1][], custody = { current: true }) {
  return mountTypedRoute(typed,
    { address: { read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} }, fixture: null,
      target: { kind: "document", ref: { session: "busy", openId: "rooms" } }, work: { address: null, open: { session: "busy", openId: "rooms" } },
      custody: { current: () => custody.current }, memory: () => ({}) },
    fingerprint,
    { work: createFixtureWorkDoor(roomsRouteState, roomsRouteState.schema.parse({})),
      sources: { "rooms.workspace": { kind: "use", open: (_ctx, deliver) => { frames.push(deliver); return () => {}; } } } });
}
const complete = (deliver: Parameters<UseSource["open"]>[1]) => deliver({ kind: "complete", revision: 1, value: { key: "busy", generation: 0, version: 1, state: "current", value: {
  data: { roomsWork: roomsRouteState.schema.parse({}), handle: null, snapshot: DEMO_ROOMS, trace: null, traceError: null, plan: null, planError: null },
  evaluation: "busy", inputs: "busy", origin: { kind: "fixture" }, trace: [], freshness: "current",
  coverage: { requested: [], covered: [], unknown: [], refused: [] } } } });
const router = (component: () => React.ReactNode) =>
  createRouter({ routeTree: createRootRoute({ component }), history: createMemoryHistory({ initialEntries: ["/"] }) });

test("6.1 a pane whose reading is pending says aria-busy, and clears it when the reading settles", async () => {
  const frames: Parameters<UseSource["open"]>[1][] = [];
  const mount = mountTypedRoute(
    { ...module, spec: { ...module.spec, panes: { main: { ...module.spec.panes.main, body: "scroll" as const, draw: () => scrollBody(<p>Rooms body</p>) } } } },
    { address: { read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} }, fixture: null,
      target: { kind: "document", ref: { session: "busy", openId: "rooms" } }, work: { address: null, open: { session: "busy", openId: "rooms" } },
      custody: { current: () => true }, memory: () => ({}) },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    { work: createFixtureWorkDoor(roomsRouteState, roomsRouteState.schema.parse({})),
      sources: { "rooms.workspace": { kind: "use", open: (_ctx, deliver) => { frames.push(deliver); return () => {}; } } } },
  );
  const router = createRouter({ routeTree: createRootRoute({ component: () => <TypedChrome mount={mount} document={null} /> }),
    history: createMemoryHistory({ initialEntries: ["/"] }) });
  try {
    render(<RouterProvider router={router} />);
    const pane = await screen.findByRole("region", { name: "Rooms" });
    expect(pane.getAttribute("aria-busy")).toBe("true");
    await act(async () => frames.at(-1)!({ kind: "complete", revision: 1, value: { key: "busy", generation: 0, version: 1, state: "current", value: {
      data: { roomsWork: roomsRouteState.schema.parse({}), handle: null, snapshot: DEMO_ROOMS, trace: null, traceError: null, plan: null, planError: null },
      evaluation: "busy", inputs: "busy", origin: { kind: "fixture" }, trace: [], freshness: "current",
      coverage: { requested: [], covered: [], unknown: [], refused: [] } } } }));
    await settled(pane);
    expect(pane.getAttribute("aria-busy")).toBeNull();
    // A refresh is unsettled again: the same mark, no route code.
    await act(async () => mount.refresh());
    expect(pane.getAttribute("aria-busy")).toBe("true");
  } finally { cleanup(); mount.dispose(); }
});

test("6.1b two Places on one route, one hidden mid-read: every aria-busy in the document clears", async () => {
  const shownFrames: Parameters<UseSource["open"]>[1][] = [], hiddenFrames: Parameters<UseSource["open"]>[1][] = [];
  const typed = roomsProbe(), hiddenCustody = { current: true };
  const shown = held(typed, shownFrames), hidden = held(typed, hiddenFrames, hiddenCustody);
  try {
    render(<RouterProvider router={router(() => <>
      <TypedChrome mount={shown} document={null} />
      <RouteVisibility.Provider value={false}><Activity mode="hidden"><TypedChrome mount={hidden} document={null} /></Activity></RouteVisibility.Provider>
    </>)} />);
    await screen.findByRole("region", { name: "Rooms" });
    // The hidden Place releases its reads as Activity hides it (TypedPlace's effect cleanup); its read never answers.
    act(() => { hiddenCustody.current = false; hidden.release(); });
    await act(async () => complete(shownFrames.at(-1)!));
    expect(hidden.value().status).toBe("pending");
    await settled(document.body);
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
  } finally { cleanup(); shown.dispose(); hidden.dispose(); }
});

test("6.1b a route the host leases no view for (chat at /pea) never PUTs a route view; a leasing route does", async () => {
  const chatFrames: Parameters<UseSource["open"]>[1][] = [], roomsFrames: Parameters<UseSource["open"]>[1][] = [];
  const chat = held(roomsProbe({ key: "chat", address: "/pea", name: "Pea" }), chatFrames), rooms = held(roomsProbe(), roomsFrames);
  call.mockClear();
  const puts = () => call.mock.calls.filter(([door]) => door === "view.publish").map(([, req]) => (req as { params: { route: string } }).params.route);
  try {
    render(<RouterProvider router={router(() => <><TypedChrome mount={chat} document={null} thread="T" /><TypedChrome mount={rooms} document={null} thread="T" /></>)} />);
    await waitFor(() => expect(puts()).toContain("rooms"));
    expect(puts()).not.toContain("chat");
  } finally { cleanup(); chat.dispose(); rooms.dispose(); }
});
