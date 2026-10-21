import { spaceViewSchema } from "@pe/agent-contracts/space-view";
import { describe, expect, it } from "vite-plus/test";
import {
  cutPolygon,
  decodeScene,
  initialView,
  insidePolygon,
  retained,
  type Metadata,
} from "./state";

const bounds = { minX: -2, minY: -2, minZ: -100, maxX: 8, maxY: 9, maxZ: 100 };
const metadata = { bounds } as Metadata;

describe("Space cuts and portable state", () => {
  it("keeps the left side of an open snaking cut without a diagonal closing cut", () => {
    const polyline: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [1, 4],
      [1, 7],
      [6, 7],
    ];
    const polygon = cutPolygon(polyline, bounds);
    const state = { plane: null, keepInside: true };
    expect(insidePolygon(0.5, 2, polyline)).toBe(false);
    expect(retained([0.5, 2, 0], state, polygon)).toBe(true);
    expect(retained([2, 2, -100], state, polygon)).toBe(true);
    expect(retained([2, 2, 100], state, polygon)).toBe(true);
    expect(retained([2, 5, 0], state, polygon)).toBe(false);
    expect(retained([2, 8, 0], state, polygon)).toBe(true);
    expect(retained([2, 5, 0], { ...state, keepInside: false }, polygon)).toBe(true);
    expect(retained([2, 2, 100], { ...state, plane: [0, 0, -1, 10] }, polygon)).toBe(false);
    const reversed = cutPolygon([...polyline].reverse(), bounds);
    expect(retained([2, 5, 0], state, reversed)).toBe(true);
    expect(retained([2, 2, 0], state, reversed)).toBe(false);
  });
  it("extends two point cuts to scope and bounds the shader polygon", () => {
    const polygon = cutPolygon(
      [
        [0, 0],
        [1, 0],
      ],
      bounds,
    );
    expect(insidePolygon(7, 8, polygon)).toBe(true);
    expect(insidePolygon(7, -1, polygon)).toBe(false);
    const maximum: [number, number][] = Array.from({ length: 56 }, (_, i) => [i, Math.sin(i)]);
    expect(cutPolygon(maximum, bounds).length).toBeLessThanOrEqual(64);
    expect(cutPolygon([[0, 0]], bounds)).toEqual([]);
    expect(() =>
      cutPolygon(
        [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
        ],
        bounds,
      ),
    ).toThrow("crosses");
  });
  it("roundtrips the canonical state and rejects malformed or unbounded state", () => {
    const state = {
      ...initialView(metadata, "a".repeat(64)),
      hidden: ["host:one"],
      polyline: [
        [0, 0],
        [1, 1],
      ],
    };
    expect(spaceViewSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(spaceViewSchema.safeParse({ ...state, plane: undefined }).success).toBe(false);
    expect(spaceViewSchema.safeParse({ ...state, plane: [0, 0, 0, 1] }).success).toBe(false);
    expect(spaceViewSchema.safeParse({ ...state, polyline: Array(57).fill([0, 0]) }).success).toBe(
      false,
    );
    expect(() => decodeScene(new ArrayBuffer(8))).toThrow("PSC1");
  });
  it("decodes aligned binary vertices and rejects overlapping element ranges", () => {
    const make = (firstVertex: number) => {
      const json = new TextEncoder().encode(
        JSON.stringify({
          format: "space-scene-v1",
          stamp: { frame: "host-internal-ft" },
          triangles: 1,
          elements: [{ firstVertex, vertexCount: 3 }],
          bounds,
        }),
      );
      const offset = Math.ceil((8 + json.length) / 4) * 4;
      const buffer = new ArrayBuffer(offset + 36);
      const header = new DataView(buffer);
      header.setUint32(0, 0x31435350, true);
      header.setUint32(4, json.length, true);
      new Uint8Array(buffer, 8, json.length).set(json);
      new Float32Array(buffer, offset).set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      return buffer;
    };
    expect([...decodeScene(make(0)).positions]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => decodeScene(make(3))).toThrow("range");
  });
});
