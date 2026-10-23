import { describe, expect, it } from "vite-plus/test";

import { createWheelReader, pointerIntent, wheelPlane } from "./gestures";

const press = (button: number, mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey", boolean>> = {}) =>
  pointerIntent({ button, shiftKey: false, ctrlKey: false, metaKey: false, ...mods });
const wheel = (deltaX: number, deltaY: number, extra = {}) => ({
  deltaX,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  ...extra,
});

describe("pointer scheme", () => {
  it("left drag orbits; Shift, right and middle drag pan", () => {
    expect(press(0)).toBe("orbit");
    expect(press(0, { shiftKey: true })).toBe("pan");
    expect(press(2)).toBe("pan");
    expect(press(1)).toBe("pan");
  });

  it("a pinch (ctrlKey wheel) is a pinch whatever its size", () => {
    expect(createWheelReader()(wheel(0, 3, { ctrlKey: true }))).toBe("pinch");
  });

  it("a mouse wheel notch zooms; fractional, two-axis or sub-notch deltas are a trackpad scroll", () => {
    expect(createWheelReader()(wheel(0, 100))).toBe("wheel");
    expect(createWheelReader()(wheel(0, 120))).toBe("wheel");
    expect(createWheelReader()(wheel(0, 1, { deltaMode: 1 }))).toBe("wheel");
    expect(createWheelReader()(wheel(0, 12.5))).toBe("scroll");
    expect(createWheelReader()(wheel(7, 9))).toBe("scroll");
    expect(createWheelReader()(wheel(0, 6))).toBe("scroll");
  });

  it("a scroll's momentum tail stays a scroll, but a later notch is a wheel again", () => {
    const read = createWheelReader();
    expect(read(wheel(2, 6, { timeStamp: 0 }))).toBe("scroll");
    expect(read(wheel(0, 120, { timeStamp: 50 }))).toBe("scroll");
    expect(read(wheel(0, 120, { timeStamp: 1000 }))).toBe("wheel");
  });

  it("on a 2D viewport a scroll pans with the fingers and a pinch zooms about the cursor", () => {
    const v = { kind: "plane" as const, scale: 1, tx: 10, ty: 10 };
    expect(wheelPlane(v, "scroll", wheel(4, 6), 0, 0)).toMatchObject({ scale: 1, tx: 6, ty: 4 });
    const zoomed = wheelPlane(v, "pinch", wheel(0, -10), 50, 50);
    expect(zoomed.scale).toBeGreaterThan(1);
    // the point under the cursor stays under it
    expect((50 - zoomed.tx) / zoomed.scale).toBeCloseTo((50 - v.tx) / v.scale);
  });
});
