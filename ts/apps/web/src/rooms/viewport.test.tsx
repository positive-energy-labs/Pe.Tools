// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_VIEW } from "./demo";
import { roomsPageSchema, type RoomsPage } from "./graph";
import { RoomsPlan } from "./plan";
import { roomRows } from "./table";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a null viewport fits without a write, wheel preserves its cursor point, and focus can return after leaving", async () => {
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
      disconnect() {}
    },
  );
  const writes = vi.fn();
  let navigate!: (next: Partial<RoomsPage>) => void;
  const rows = roomRows(DEMO_ROOMS.regions, ["Fixture level"]);
  function Plan() {
    const [page, set] = useState(() => roomsPageSchema.parse({ view: DEMO_VIEW }));
    navigate = (next) => set((previous) => ({ ...previous, ...next }));
    return (
      <RoomsPlan
        rows={rows}
        plan={DEMO_PLAN}
        planRefusal={null}
        planError={null}
        empty={null}
        zoomTo={page.focus ? [rows[1]!.region.guid] : []}
        focusMissing={[]}
        onSelect={() => {}}
        trace={{ data: null, none: "no trace" }}
        page={page}
        setPage={(next, move) => {
          writes(next, move);
          navigate(next);
        }}
      />
    );
  }
  const view = render(<Plan />);
  const host = view.container.querySelector<HTMLElement>("[data-rooms-plan]")!;
  expect(writes).not.toHaveBeenCalled();
  const pose = () => {
    const [tx, ty, scale] = host
      .firstElementChild!.getAttribute("style")!
      .match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)!
      .slice(1)
      .map(Number);
    return { tx: tx!, ty: ty!, scale: scale! };
  };
  const initial = pose();
  fireEvent.wheel(host, { clientX: 200, clientY: 150, deltaY: -120 });
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
  const next = pose();
  expect((200 - initial.tx) / initial.scale).toBeCloseTo((200 - next.tx) / next.scale);
  expect((150 - initial.ty) / initial.scale).toBeCloseTo((150 - next.ty) / next.scale);
  expect(writes.mock.calls[0]![1]).toEqual({ history: "replace" });
  act(() => navigate({ focus: "R2" }));
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
  expect(writes.mock.calls[1]![1]).toEqual({ history: "push" });
  fireEvent.wheel(host, { clientX: 200, clientY: 150, deltaY: 120 });
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(3));
  act(() => navigate({ focus: "" }));
  act(() => navigate({ focus: "R2" }));
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(4));
  expect(writes.mock.calls[3]![1]).toEqual({ history: "push" });
});
