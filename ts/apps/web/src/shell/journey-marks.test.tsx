// @vitest-environment jsdom
// Slice 6.1: a pane's busy mark derives from the reading the kernel holds; a route never sets it.
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
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
