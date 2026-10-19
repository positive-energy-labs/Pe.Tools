/** The detail inset's trigger, deterministic: it wakes on a crowd of places and sleeps otherwise. */
import { expect, it } from "vite-plus/test";

import { DENSE_N, DENSE_PX, denseRegion } from "./inset";

it("denseRegion wakes the inset on DENSE_N places within DENSE_PX and sleeps otherwise", () => {
  const crowd = Array.from({ length: DENSE_N }, (_, i) => ({ id: i, x: 100 + i * 10, y: 100 }));
  const spread = Array.from({ length: DENSE_N + 2 }, (_, i) => ({
    id: 100 + i,
    x: i * (DENSE_PX + 1),
    y: 0,
  }));
  expect(denseRegion(spread)).toBeNull();
  expect(denseRegion(crowd.slice(0, DENSE_N - 1))).toBeNull();
  const region = denseRegion([...spread, ...crowd]);
  expect(region && [...region.ids].sort((a, b) => a - b)).toEqual(crowd.map((p) => p.id));
  expect(region?.box).toEqual({ minX: 100, minY: 100, maxX: 100 + (DENSE_N - 1) * 10, maxY: 100 });
});
