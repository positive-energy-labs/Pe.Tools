// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { SpecSheet } from "#/family/doc-pane";
import type { ProtoSpec } from "#/family/world";

vi.mock("@pe/kit/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

const block = (id: string, y: number) => ({
  id,
  page: 1,
  kind: "text",
  md: id,
  bboxes: [{ x: 0, y, w: 100, h: 10 }],
});
const spec: ProtoSpec = {
  jobId: "job",
  fileName: "cut.pdf",
  pages: [{ page: 1, width: 100, height: 1000, screenshotUrl: null, markdown: "" }],
  blocks: [block("b1", 0), block("b2", 800)],
  images: [],
};

// jsdom lays nothing out: the far block sits 500px below the pane's top.
vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
  const top = this.getAttribute("data-block-id") === "b2" ? 500 : 0;
  return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
});

test("hover lights a block without scrolling the sheet; only a locate scrolls (N1)", () => {
  const props = { spec, zoom: 1, onZoom: () => {} };
  const view = render(<SpecSheet {...props} litBlocks={new Set()} />);
  const pane = view.container.firstElementChild as HTMLElement;
  act(() => view.rerender(<SpecSheet {...props} litBlocks={new Set(["b2"])} />));
  expect(pane.scrollTop).toBe(0);
  act(() =>
    view.rerender(
      <SpecSheet {...props} litBlocks={new Set(["b2"])} reveal={{ block: "b2", n: 1 }} />,
    ),
  );
  expect(pane.scrollTop).toBe(500);
});
