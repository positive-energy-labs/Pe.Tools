// @vitest-environment jsdom
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_VIEW } from "./demo";
import { roomsPageSchema } from "./graph";
import { RoomsPlan } from "./plan";
import { Pane } from "@pe/kit/lang/pane";
import { RoomsTable, roomRows } from "./table";

test("stagedRoomWrites sends edit values per guid and never a suggestion", () => {
  const doc = roomsRouteState.schema.parse({
    edits: {
      [roomEditKey("a", "name")]: { edit: { value: "Pantry" } },
      [roomEditKey("a", "people")]: { edit: { value: 2 } },
      [roomEditKey("b", "type")]: { edit: { value: "kitchen" } },
      [roomEditKey("b", "role")]: { edit: { value: "zone" } },
      [roomEditKey("b", "ceilingFt")]: { suggestion: { value: 9 } },
      [roomEditKey("c", "name")]: { suggestion: { value: "Pea's idea" } },
    },
  });
  expect(stagedRoomWrites(doc)).toEqual([
    { guid: "a", name: "Pantry", people: 2 },
    { guid: "b", type: "kitchen", role: "zone" },
  ]);
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "role")]: { edit: { value: "held" } } },
    }).success,
  ).toBe(false);
});

test("the Work refuses a value its field does not accept", () => {
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "people")]: { edit: { value: "two" } } },
    }).success,
  ).toBe(false);
  expect(
    roomsRouteState.schema.safeParse({ edits: { '["a"]': { edit: { value: 1 } } } }).success,
  ).toBe(false);
});

test("a locked stale region keeps both facts in the plan, legend and table, and still selects", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private read: ResizeObserverCallback) {}
      observe() {
        this.read(
          [{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // fixture-1 is locked; make it stale as well. fixture-2 is stale alone.
  const regions = DEMO_ROOMS.regions.map((region) =>
    region.guid === "fixture-1" ? { ...region, stale: true } : region,
  );
  const rows = roomRows(regions, ["Fixture level"]);
  const page = roomsPageSchema.parse({ view: DEMO_VIEW });
  const onSelect = vi.fn();
  const view = render(
    <>
      <RoomsTable
        rows={rows}
        cells={{}}
        wire={{ segment: "edits", revision: 0, write: vi.fn() } as never}
        onSelect={() => {}}
        empty={{ says: "empty", exit: "none" }}
      />
      <RoomsPlan
        renderPane={(body, furniture) => (
          <Pane picture {...furniture}>
            {body}
          </Pane>
        )}
        rows={rows}
        plan={DEMO_PLAN}
        planRefusal={null}
        planError={null}
        empty={null}
        zoomTo={[]}
        focusMissing={[]}
        onSelect={onSelect}
        trace={{ data: null, none: "fixture" }}
        page={page}
        setPage={() => {}}
      />
    </>,
  );
  const path = view.container.querySelector<SVGPathElement>('path[data-subject="room:fixture-1"]')!;
  expect(path.getAttribute("data-state")).toBe("locked");
  expect(path.getAttribute("data-stale")).toBe("true");
  await waitFor(() => expect(path.getAttribute("aria-description")).toBe("locked · stale"));
  // Locked keeps the outline; the fill takes stale's caution ink.
  expect(path.getAttribute("stroke")).not.toBe(path.getAttribute("fill"));
  expect(path.getAttribute("fill")).toContain(
    view.container.querySelector('path[data-subject="room:fixture-2"]')!.getAttribute("stroke"),
  );
  const legend = view.container.querySelector('[aria-label="rooms legend"]')!.textContent!;
  expect(legend).toMatch(/locked\D*1/);
  expect(legend).toMatch(/stale\D*2/);
  expect(view.container.querySelector('tr[data-subject="room:fixture-1"]')!.textContent).toContain(
    "locked · stale",
  );
  fireEvent.click(path);
  expect(onSelect).toHaveBeenCalledWith("fixture-1", false);
  cleanup();
  vi.unstubAllGlobals();
});
