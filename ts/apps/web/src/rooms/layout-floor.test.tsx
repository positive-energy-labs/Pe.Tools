// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { roomsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { mountTypedRoute } from "../shell/typed-mount";
import { DEMO_PLAN, DEMO_ROOMS } from "./demo";
import { roomsGoal } from "./goal";
import { RoomsBody } from "./mount";
import { module, type RoomsContext } from "./route";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("at a 1160px Rooms body seven regions keep their rows and the plan in view", () => {
  const work = roomsRouteState.schema.parse({});
  const room = DEMO_ROOMS.regions[1]!;
  const view = room.view;
  const snapshot = {
    ...DEMO_ROOMS,
    regions: Array.from({ length: 7 }, (_, index) => ({
      ...room,
      elementId: 1001 + index,
      guid: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    })),
  };
  const address = new URLSearchParams({ view: JSON.stringify(view) });
  const ref = { session: "fixture", openId: "rooms-layout" };
  const mount = mountTypedRoute(
    module,
    {
      address: { read: () => address, write: () => {}, subscribe: () => () => {} },
      fixture: null,
      target: { kind: "document", ref },
      work: { address: null, open: ref },
      custody: { current: () => true },
      memory: () => ({}),
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      work: createFixtureWorkDoor(roomsRouteState, work),
      sources: {
        "rooms.workspace": {
          kind: "use",
          open: (_ctx, deliver) => {
            deliver({
              kind: "complete",
              revision: 1,
              value: {
                key: "rooms-layout",
                generation: 0,
                version: 1,
                state: "current",
                value: {
                  data: {
                    ...roomsGoal(work, snapshot, view),
                    roomsWork: work,
                    handle: null,
                    snapshot,
                    trace: null,
                    traceError: null,
                    plan: { plan: DEMO_PLAN },
                    planError: null,
                  },
                  evaluation: "rooms-layout",
                  inputs: "rooms-layout",
                  origin: { kind: "fixture" },
                  works: [],
                  trace: [],
                  freshness: "current",
                  coverage: { requested: [], covered: [], unknown: [], refused: [] },
                },
              },
            });
          },
        },
      },
    },
  );
  try {
    const bounds = new DOMRect(0, 0, 1160, 850);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private read: ResizeObserverCallback) {}
        observe() {
          this.read([{ contentRect: bounds }] as ResizeObserverEntry[], this as ResizeObserver);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(bounds);
    const { container } = render(
      <div style={{ width: 1160, height: 850 }}>
        {mount.draw<RoomsContext>("main", (ctx) => <RoomsBody ctx={ctx} />) as React.ReactNode}
      </div>,
    );
    const table = container.querySelector("[data-table]")!;
    expect(table.querySelectorAll("tbody > tr[data-subject]")).toHaveLength(7);
    const picture = container.querySelector("[data-rooms-plan]")!;
    expect(picture.querySelector('image[data-layer="plan-image"]')).toBeTruthy();
    expect(module.spec.panes.main!.body).toBe("fill");
    const scroller = table.closest("[data-table-scroll]")!;
    expect(scroller.classList.contains("flex-1")).toBe(true);
    const regions = scroller.closest("[data-rooms-regions]")!;
    expect(regions.classList.contains("min-w-0")).toBe(true);
    expect(regions.classList.contains("min-h-0")).toBe(true);
    const split = regions.parentElement!;
    expect(split.classList.contains("grid-rows-2")).toBe(true);
    expect(split.classList.contains("@min-[1100px]:grid-rows-1")).toBe(true);
    expect(split.classList.contains("@min-[1100px]:grid-cols-2")).toBe(true);
    expect(split.firstElementChild?.contains(picture)).toBe(true);
    const css = readFileSync(resolve(import.meta.dirname, "layout.css"), "utf8");
    expect(css).toMatch(
      /\[data-rooms-regions\] \[data-table-scroll\]\s*\{\s*container-name: none;/,
    );
    expect(css).toMatch(/\[data-rooms-regions\] \[data-table\]\s*\{\s*min-width: 70rem;/);
  } finally {
    mount.dispose();
  }
});
