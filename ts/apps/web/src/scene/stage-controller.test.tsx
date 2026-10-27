// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
import { PictureStage, useStage, stageViewport, projectBounds } from "./stage-controller";
import { makeAtomRegistry } from "#/route/route-owner";
import { TestAttention } from "#/test-attention";
import { mention } from "@pe/kit/lang/attention";
import { Row } from "@pe/kit/lang/row";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { frame } from "./orbit";
import { Pane } from "@pe/kit/lang/pane";
import { viewportCodec } from "@pe/agent-contracts";
import { Profiler, useState } from "react";
import { Composer } from "#/components/lang/conversation";

vi.mock("./view-history", () => ({ useViewHistory: () => vi.fn() }));
afterEach(cleanup);

it("plane marks and rows share native identity without route hover handlers", () => {
  const registry = makeAtomRegistry();
  const view = render(
    <TestAttention registry={registry}>
      <Row label="region" revit={[42]} />
      <div data-testid="picture">
        <svg>
          <path {...mention({ doc: "test", key: "e:42" })} {...revitTarget([42])} d="M0 0L1 1" />
        </svg>
      </div>
    </TestAttention>,
  );
  const row = view.getByText("region").closest(".dl-row")!;
  const mark = view.container.querySelector("path[data-revit-ids]")!;
  fireEvent.pointerOver(row);
  expect(mark.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerOver(view.getByTestId("picture"));
  expect(mark.getAttribute("data-reach")).toBe("rest");
  fireEvent.pointerOver(mark);
  expect(row.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerLeave(view.container.firstElementChild!);
  expect(row.getAttribute("data-reach")).toBe("rest");
});

it("projected bounds use client coordinates and refuse points behind the camera", () => {
  const bounds = { minX: 1, minY: 2, minZ: 0, maxX: 3, maxY: 4, maxZ: 1 };
  expect(projectBounds(bounds, ([x, y]) => [x! * 2, y! * 3], { left: 10, top: 20 })).toEqual(
    new DOMRect(12, 26, 4, 6),
  );
  expect(projectBounds(bounds, () => null, { left: 10, top: 20 })).toBeNull();
});

it("sibling send preserves picture and focus; projection controls and history remain live", () => {
  const commits = vi.fn();
  const pose = {
    ...frame({ minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 20, maxZ: 30 }),
    projection: "perspective" as const,
  };
  const publish = vi.fn();
  const orbit = createLiveOrbit(pose, stageViewport(publish));
  const clearSelection = () => {};
  function Picture() {
    const stage = useStage();
    return (
      <Profiler id="picture" onRender={commits}>
        <Pane picture legend={null}>
          {stage.goTo}
          {/* The globe hosts the projection control (stage-globe.tsx); the pane strip does not. */}
          {stage.projection}
        </Pane>
      </Profiler>
    );
  }
  const picture = <Picture />;
  function Surface() {
    const [sent, setSent] = useState(0);
    return (
      <>
        <PictureStage
          kind="orbit"
          orbit={orbit}
          host={null}
          bounds={null}
          selectedBounds={null}
          clearSelection={clearSelection}
          goTo={null}
        >
          {picture}
        </PictureStage>
        <Pane>
          <Composer
            aria-label="Message"
            defaultValue="hello"
            send={null}
            onSend={() => setSent(sent + 1)}
          />
        </Pane>
        <output>{sent}</output>
      </>
    );
  }
  const view = render(<Surface />);
  expect(commits.mock.calls.length).toBeGreaterThan(0);
  const area = screen.getByRole("textbox", { name: "Message" });
  area.focus();
  commits.mockClear();
  fireEvent.keyDown(area, { key: "Enter" });
  expect(view.container.querySelector("output")?.textContent).toBe("1");
  expect(document.activeElement).toBe(area);
  expect(commits).not.toHaveBeenCalled();
  const parallel = screen.getByRole("button", { name: "parallel" });
  fireEvent.click(parallel);
  const next = { ...pose, projection: "parallel" as const };
  expect(orbit.read()).toEqual(next);
  expect(publish).toHaveBeenCalledExactlyOnceWith({ viewport: next }, { history: "push" });
  expect(parallel.getAttribute("aria-pressed")).toBe("true");
  act(() => orbit.restore(viewportCodec.decode(viewportCodec.encode(pose)) as typeof pose));
  expect(parallel.getAttribute("aria-pressed")).toBe("false");
  parallel.focus();
  fireEvent.keyDown(view.container.querySelector("section")!, { key: "o", code: "KeyO" });
  expect(orbit.read()).toEqual(viewportCodec.decode(viewportCodec.encode(next)));
  expect(publish).toHaveBeenCalledTimes(2);
});
