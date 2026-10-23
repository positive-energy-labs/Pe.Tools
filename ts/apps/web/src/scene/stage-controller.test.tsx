// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
import { PictureStage, useStage, stageViewport, projectBounds } from "./stage-controller";
import { useStageReach } from "./reach";
import { Row } from "@pe/kit/lang/row";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { frame } from "./orbit";
import { Pane } from "@pe/kit/lang/pane";
import { viewportCodec } from "@pe/agent-contracts";

vi.mock("./view-history", () => ({ useViewHistory: () => vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("plane marks and rows share native identity without route hover handlers", () => {
  const view = render(
    <>
      <Row label="region" revit={[42]} />
      <div data-testid="picture">
        <svg>
          <path {...revitTarget([42])} d="M0 0L1 1" />
        </svg>
      </div>
    </>,
  );
  const stage = renderHook(() => useStageReach(view.getByTestId("picture")));
  const row = view.getByText("region").closest(".dl-row")!;
  const mark = view.container.querySelector("path[data-revit-ids]")!;
  fireEvent.mouseEnter(row);
  expect(mark.getAttribute("data-reach")).toBe("hover");
  fireEvent.mouseLeave(row);
  expect(mark.getAttribute("data-reach")).toBe("rest");
  fireEvent.pointerOver(mark);
  expect(row.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerLeave(view.getByTestId("picture"));
  expect(row.getAttribute("data-reach")).toBe("rest");
  stage.unmount();
  view.unmount();
});

it("projected bounds use client coordinates and refuse points behind the camera", () => {
  const bounds = { minX: 1, minY: 2, minZ: 0, maxX: 3, maxY: 4, maxZ: 1 };
  expect(projectBounds(bounds, ([x, y]) => [x! * 2, y! * 3], { left: 10, top: 20 })).toEqual(
    new DOMRect(12, 26, 4, 6),
  );
  expect(projectBounds(bounds, () => null, { left: 10, top: 20 })).toBeNull();
});

function StageActions() {
  return useStage().goTo;
}

it("the stage supplies a projection Switcher and O publishes one restorable named move", () => {
  const pose = frame({ minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 20, maxZ: 30 });
  const publish = vi.fn();
  const orbit = createLiveOrbit(pose, stageViewport(publish));
  const view = render(
    <PictureStage
      kind="orbit"
      orbit={orbit}
      host={null}
      bounds={null}
      selectedBounds={null}
      clearSelection={() => {}}
      goTo={null}
    >
      <Pane picture title="picture" legend={null}>
        <StageActions />
      </Pane>
    </PictureStage>,
  );
  const parallel = screen.getByRole("button", { name: "parallel" });
  fireEvent.click(parallel);
  const next = { ...pose, projection: "parallel" };
  expect(orbit.read()).toEqual(next);
  expect(publish).toHaveBeenCalledExactlyOnceWith({ viewport: next }, { history: "push" });
  expect(parallel.getAttribute("aria-pressed")).toBe("true");
  act(() => orbit.restore(viewportCodec.decode(viewportCodec.encode(pose)) as typeof pose));
  expect(parallel.getAttribute("aria-pressed")).toBe("false");
  fireEvent.keyDown(view.container.querySelector("section")!, { key: "o", code: "KeyO" });
  expect(orbit.read()).toEqual(next);
  expect(publish).toHaveBeenCalledTimes(2);
  view.unmount();
});
