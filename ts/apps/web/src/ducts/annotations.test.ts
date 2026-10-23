import { expect, it } from "vite-plus/test";
import { placeChips, placeLabels } from "./annotations";

it("footnote chips sit above their anchors, clear each other and the anchors, and stay in the picture", () => {
  const size = { width: 400, height: 300 };
  // Five anchors within a few pixels: close connectors on one fitting.
  const anchors = [0, 1, 2, 3, 4].map((i) => ({ x: 200 + i * 3, y: 150 + (i % 2) * 2, n: i + 1 }));
  const chips = placeChips(anchors, size);
  expect(chips[0]).toEqual({ x: 200, y: 126 });
  const boxes = chips.map((c, i) => {
    const w = 9 + 7 * String(anchors[i]!.n).length;
    return { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - 8, y1: c.y + 8 };
  });
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
  const project = (p: readonly number[]) => [p[0]!, p[1]!] as [number, number];
  const placed = placeLabels(
    [
      { key: "leg", at: [10, 10, 0], text: "Σ 121 eq ft", priced: true },
      { key: "path", at: [11, 10, 0], text: "Σ 121 eq ft", priced: true },
      { key: "other", at: [10, 10, 0], text: "Σ 45 eq ft", priced: true },
    ],
    project as never,
  );
  expect(placed.map((p) => [p.key, p.y])).toEqual([
    ["leg", 24],
    ["other", 36],
  ]);
});
