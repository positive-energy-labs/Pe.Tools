import { describe, expect, it } from "vite-plus/test";

import {
  layersKey,
  layersOf,
  modeKey,
  toggleLayer,
  viewportCodec,
  viewportKey,
  type Viewport,
} from "./page-keys.ts";

describe("viewportCodec", () => {
  it("round-trips each kind", () => {
    const views: Viewport[] = [
      { kind: "scroll", top: 1200, left: 0 },
      { kind: "plane", scale: 0.8, tx: -120, ty: 33 },
      { kind: "orbit", yaw: 45, elev: 30, zoom: 1.25, pivot: [120.5, -40, 12] },
    ];
    for (const view of views)
      expect(viewportCodec.decode(viewportCodec.encode(view))).toEqual(view);
    expect(viewportCodec.encode(views[2]!)).toBe("orbit:45,30,1.25@120.5,-40,12");
  });

  it("writes three decimals", () => {
    expect(viewportCodec.encode({ kind: "plane", scale: 1 / 3, tx: -0.0001, ty: 2 })).toBe(
      "plane:0.333,0,2",
    );
  });

  it("reads malformed input as null", () => {
    for (const bad of [
      "",
      "orbit",
      "plane:1,2",
      "plane:1,2,3,4",
      "scroll:1,x",
      "scroll:1e3,0",
      "orbit:1,2,3",
      "orbit:1,2,3@4,5",
      "orbit:1,2,3@4,5,6@7",
      "tilt:1,2",
    ])
      expect(viewportCodec.decode(bad)).toBeNull();
  });

  it("the key holds a typed view, defaults to the initial one, and refuses a malformed one", () => {
    const key = viewportKey({ kind: "scroll", top: 0, left: 0 });
    expect(key.parse(undefined)).toEqual({ kind: "scroll", top: 0, left: 0 });
    expect(key.safeParse("scroll:0,0").success).toBe(false);
    expect(key.safeParse({ kind: "plane", scale: 1, tx: 0 }).success).toBe(false);
  });
});

describe("modeKey and layers", () => {
  const LAYERS = ["rails", "openings", "network", "faces"] as const;

  it("modeKey defaults and refuses an unknown mode", () => {
    const key = modeKey(["iso", "plan"], "iso");
    expect(key.parse(undefined)).toBe("iso");
    expect(key.safeParse("side").success).toBe(false);
  });

  it("layersKey defaults to the on layers, in layers order", () => {
    expect(layersKey(LAYERS, ["faces", "rails"]).parse(undefined)).toBe("rails,faces");
  });

  it("layersOf keeps order and drops unknown names", () => {
    expect(layersOf(LAYERS, "faces, rails,bogus")).toEqual(["rails", "faces"]);
    expect(layersOf(LAYERS, "")).toEqual([]);
  });

  it("toggleLayer is an involution", () => {
    for (const value of ["", "rails", "rails,faces", "openings,network,faces"])
      for (const layer of LAYERS)
        expect(toggleLayer(LAYERS, toggleLayer(LAYERS, value, layer), layer)).toBe(value);
    expect(toggleLayer(LAYERS, "faces", "rails")).toBe("rails,faces");
    expect(toggleLayer(LAYERS, "rails", "rails")).toBe("");
  });
});
