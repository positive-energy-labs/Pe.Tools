import { layoutCaptions } from "./subject-labels";
import { expect, it } from "vite-plus/test";
import { placeChips } from "./annotations";

it("footnote chips sit above their anchors, clear each other and the anchors, and stay in the picture", () => {
  const size = { width: 400, height: 300 };
  // Five anchors within a few pixels: close connectors on one fitting.
  const anchors = [0, 1, 2, 3, 4].map((i) => ({ x: 200 + i * 3, y: 150 + (i % 2) * 2, n: i + 1 }));
  const chips = placeChips(anchors, size);
  expect(chips).toHaveLength(anchors.length);
  expect(chips[0]).toEqual({ x: 189, y: 115, width: 22, height: 22, n: 1 });
  const boxes = chips.map((c) => ({ x0: c.x, x1: c.x + c.width, y0: c.y, y1: c.y + c.height }));
  for (const [i, a] of boxes.entries()) {
    expect(a.x0).toBeGreaterThanOrEqual(0);
    expect(a.y1).toBeLessThanOrEqual(size.height);
    for (const b of boxes.slice(i + 1))
      expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
  }
  // An anchor at the top edge puts its chip below or beside, never off the picture.
  const [top] = placeChips([{ x: 200, y: 4, n: 12 }], size);
  expect(top!.y).toBeGreaterThan(4);
});

it("loss labels: the same words at one place draw once; different words step down", () => {
  const placed = layoutCaptions(
    [
      { key: "leg", x: 18, y: 24, text: "Σ 121 eq ft", priced: true },
      { key: "path", x: 19, y: 24, text: "Σ 121 eq ft", priced: true },
      { key: "other", x: 18, y: 24, text: "Σ 45 eq ft", priced: true },
    ],
    { x: 0, y: 0, width: 400, height: 300 },
  );
  expect(placed.map((p) => [p.key, p.y])).toEqual([
    ["leg", 24],
    ["other", 36],
  ]);
});

it("hover gives a dropped caption priority without overprinting another caption", () => {
  const labels = [1, 2].map((id) => ({
    key: String(id),
    x: 0,
    y: 10,
    text: `subject ${id}`,
    ids: [id],
  }));
  const bounds = { x: 0, y: 0, width: 80, height: 12 };
  expect(layoutCaptions(labels, bounds).map((p) => p.key)).toEqual(["1"]);
  expect(layoutCaptions(labels, bounds, [], 2).map((p) => p.key)).toEqual(["2"]);
});
