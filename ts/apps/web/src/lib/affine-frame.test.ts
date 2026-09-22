import { describe, expect, it } from "vite-plus/test";

import { boundsOf, contentViewport, fitFrame, unionBounds, type Point2 } from "./affine-frame";

describe("affine frame", () => {
  it("fits and round-trips both axis directions", () => {
    const content = boundsOf([
      [-10, 5],
      [30, 45],
    ]);

    for (const yAxis of ["down", "up"] as const) {
      const frame = fitFrame(content, { width: 800, height: 400 }, { padding: 20, yAxis });
      for (const point of [
        [-10, 5],
        [30, 45],
        [7, 19],
      ] as Point2[]) {
        const roundTrip = frame.toContent(frame.toViewport(point));
        expect(roundTrip[0]).toBeCloseTo(point[0]);
        expect(roundTrip[1]).toBeCloseTo(point[1]);
      }
    }
  });

  it("unions bounds and honors scale caps", () => {
    const content = unionBounds(
      boundsOf([
        [0, 0],
        [10, 10],
      ]),
      boundsOf([
        [-5, 4],
        [3, 20],
      ]),
    );
    const frame = fitFrame(content, { width: 500, height: 500 }, { maxScale: 2.2 });

    expect(content).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 20 });
    expect(frame.scale).toBe(2.2);
  });

  // Round-tripping holds for ANY invertible affine — these pin the actual placement.
  it("yAxis up puts content minY at the viewport BOTTOM; down puts it at the top", () => {
    const content = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const viewport = { width: 100, height: 100 };
    const up = fitFrame(content, viewport, { yAxis: "up" });
    expect(up.toViewport([0, 0])[1]).toBeCloseTo(100); // model floor → SVG bottom
    expect(up.toViewport([0, 10])[1]).toBeCloseTo(0); // model ceiling → SVG top
    const down = fitFrame(content, viewport, { yAxis: "down" });
    expect(down.toViewport([0, 0])[1]).toBeCloseTo(0);
    expect(down.toViewport([0, 10])[1]).toBeCloseTo(100);
  });

  it("keeps every content corner inside the padded viewport, both orientations", () => {
    const content = { minX: -7, minY: 3, maxX: 41, maxY: 12 };
    const viewport = { width: 300, height: 200 };
    const padding = 24;
    for (const yAxis of ["down", "up"] as const) {
      const frame = fitFrame(content, viewport, { padding, yAxis });
      for (const [x, y] of [
        [content.minX, content.minY],
        [content.maxX, content.maxY],
        [content.minX, content.maxY],
        [content.maxX, content.minY],
      ] as Point2[]) {
        const [vx, vy] = frame.toViewport([x, y]);
        expect(vx).toBeGreaterThanOrEqual(padding - 1e-9);
        expect(vx).toBeLessThanOrEqual(viewport.width - padding + 1e-9);
        expect(vy).toBeGreaterThanOrEqual(padding - 1e-9);
        expect(vy).toBeLessThanOrEqual(viewport.height - padding + 1e-9);
      }
    }
  });

  it("refuses padding the viewport cannot afford, naming the numbers — degradation is the caller's policy", () => {
    expect(() =>
      fitFrame(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { width: 20, height: 20 },
        { padding: 16 },
      ),
    ).toThrowError(/20×20.*padding 16/);
  });

  it("refuses an invalid contentViewport ratio", () => {
    expect(() => contentViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, -0.5)).toThrowError(
      /padRatio/,
    );
  });

  it("contentViewport yields a scale-1 frame — pure Y-flip plus pad", () => {
    const content = { minX: 5, minY: -3, maxX: 45, maxY: 17 };
    const { viewport, padding } = contentViewport(content, 0.03);
    const frame = fitFrame(content, viewport, { padding, yAxis: "up" });
    expect(frame.scale).toBeCloseTo(1);
    const [vx, vy] = frame.toViewport([5, 17]);
    expect(vx).toBeCloseTo(padding);
    expect(vy).toBeCloseTo(padding);
  });

  it("aligns fitted content without changing the mapping interface", () => {
    const frame = fitFrame(
      { minX: 10, minY: 20, maxX: 110, maxY: 220 },
      { width: 500, height: 500 },
      { align: [0.5, 0], padding: 20 },
    );

    expect(frame.toViewport([10, 20])[1]).toBe(20);
    expect(frame.toViewport([60, 20])[0]).toBe(250);
  });
});
