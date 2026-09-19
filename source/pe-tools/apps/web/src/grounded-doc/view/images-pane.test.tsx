// @vitest-environment jsdom
/**
 * The images pane is the one List: each figure is a Row with its thumbnail as the lead. The one
 * grounded-doc focus is the list's cursor, from any pane; the pin is the selection, and a pick
 * toggles it.
 */
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { useGroundedDoc, type GroundedDocEngine } from "#/grounded-doc/engine";
import { SAMPLE_DOC } from "#/grounded-doc/sample";
import { ImagesPane } from "#/grounded-doc/view/images-pane";

afterEach(cleanup);

const bbox = { x: 0, y: 0, w: 10, h: 10 };
const doc = {
  ...SAMPLE_DOC,
  images: [
    { id: "img-a", page: 1, category: "embedded" as const, url: "a.png", bbox },
    { id: "img-b", page: 1, category: "layout" as const, url: "b.png", bbox },
  ],
};

test("figures are rows of the one List: focus is the cursor, the pin is the selection", () => {
  let engine!: GroundedDocEngine;
  function Host() {
    engine = useGroundedDoc({ initialDoc: doc });
    const refs = useRef(new Map<string, HTMLElement>());
    return <ImagesPane engine={engine} refs={refs} />;
  }
  render(<Host />);
  const list = screen.getByRole("listbox", { name: "figures" });
  const [a, b] = within(list).getAllByRole("option");
  expect(within(a!).getByRole("img").getAttribute("src")).toBe("a.png");

  // Focus from another pane (a hovered markdown block) is this list's cursor.
  act(() => engine.hoverBlock("img-b", "markdown"));
  expect(b!.hasAttribute("data-cursor")).toBe(true);
  expect(a!.hasAttribute("data-cursor")).toBe(false);

  // Hovering a row focuses its figure everywhere.
  fireEvent.mouseMove(a!);
  expect(engine.focus?.blockId).toBe("img-a");

  // A pick pins; picking the pinned figure again unpins.
  fireEvent.click(a!);
  expect(engine.pinned?.blockId).toBe("img-a");
  expect(a!.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(a!);
  expect(engine.pinned).toBeNull();
});
