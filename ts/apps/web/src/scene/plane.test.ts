import { describe, expect, it } from "vite-plus/test";
import {
  PLANE_AXES,
  PLANE_ZOOM,
  fitView,
  fitPlane,
  frameRect,
  fromFrame,
  planeCentre,
  toFrame,
  zoomPlane,
  boundPlane,
} from "./plane";
import { cameraBounds } from "./orbit";

const bounds = { minX: -2, minY: -2, minZ: -100, maxX: 8, maxY: 9, maxZ: 100 };

it("clamps an axis camera's extent and centre after zooming, panning or restoring", () => {
  const size = { width: 800, height: 500 };
  const limits = cameraBounds(bounds, 2, 0.25);
  for (const axis of PLANE_AXES) {
    const v = boundPlane(axis, { kind: "plane", scale: 0.0001, tx: -1e6, ty: 1e6 }, size, limits);
    expect(Math.max(size.width, size.height) / v.scale).toBeCloseTo(limits.reach, 8);
    const [u, w] = planeCentre(v, size);
    const rect = frameRect(axis, limits.pan);
    expect(u).toBeCloseTo(rect.u1, 8);
    expect(w).toBeCloseTo(rect.v1, 8);
  }
});

describe("axis planes", () => {
  it("maps each axis frame right-handed and back, and frames the scene bounds per axis", () => {
    const p = [3, -1, 7];
    for (const axis of PLANE_AXES) expect(fromFrame(axis, ...toFrame(axis, p))).toEqual(p);
    // Top looks down Z with X right; North looks south (-X right, Z up); East looks west (Y right, Z up).
    expect(toFrame("top", p)).toEqual([3, -1, 7]);
    expect(toFrame("north", p)).toEqual([-3, 7, -1]);
    expect(toFrame("east", p)).toEqual([-1, 7, 3]);
    expect(frameRect("north", bounds)).toEqual({ u0: -8, u1: 2, v0: -100, v1: 100, w0: -2, w1: 9 });
    expect(frameRect("east", bounds)).toEqual({ u0: -2, u1: 9, v0: -100, v1: 100, w0: -2, w1: 8 });
  });
  it("fits the frame centred with v up, and zooms about the pointer", () => {
    const size = { width: 400, height: 200 };
    const fit = fitPlane("top", bounds, size);
    // 10 x 11 ft into 400 x 200 px: the height binds, with a 12% margin.
    expect(fit.scale).toBeCloseTo(200 / 11 / 1.12, 9);
    expect(planeCentre(fit, size)).toEqual([3, 3.5].map((n) => expect.closeTo(n, 9)));
    // Frame point (u, v) sits at (u * scale + tx, ty - v * scale): the top edge (v = 9) is above centre.
    expect(fit.ty - 9 * fit.scale).toBeLessThan(100);
    const zoomed = zoomPlane(fit, 2, 10, 20);
    const at = (v: typeof fit, u: number, w: number) => [u * v.scale + v.tx, v.ty - w * v.scale];
    const under = [(10 - fit.tx) / fit.scale, (fit.ty - 20) / fit.scale] as const;
    expect(at(zoomed, ...under)).toEqual([10, 20].map((n) => expect.closeTo(n, 9)));
    expect(zoomed.scale).toBeCloseTo(fit.scale * 2, 9);
  });
  it("fits a y-down plan padded and zoom-clamped, centred on the box", () => {
    const size = { width: 400, height: 200 };
    const box = { minX: 10, minY: 20, maxX: 30, maxY: 60 };
    const fit = fitView(box, size, 20);
    // 20 x 40 into (400 - 40) x (200 - 40): the height binds at 4 px per unit.
    expect(fit.scale).toBeCloseTo(4, 9);
    // The box centre (20, 40) lands at the canvas centre, y down.
    expect([20 * fit.scale + fit.tx, 40 * fit.scale + fit.ty]).toEqual([200, 100]);
    // A point-sized box does not zoom past the clamp.
    expect(fitView({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, size).scale).toBe(PLANE_ZOOM[1]);
  });
});
