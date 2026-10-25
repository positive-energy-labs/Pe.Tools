import { describe, expect, it } from "vite-plus/test";
import { decodeScene, type Psc1Metadata } from "./psc1";
import { CATEGORY_IDS } from "./categories";
import { contextVisible } from "./context";
import { LOOK } from "./grounds";

const BOX = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
const handle = (elementId: number, linkInstanceId: number | null = null) =>
  ({
    documentKey: "doc-a",
    elementId,
    uniqueId: `u-${elementId}`,
    linkInstanceId,
    category: elementId === 1 ? "Ducts" : "Walls",
    // The decoder reads these fields only; the op's full Handle carries more.
  }) as Psc1Metadata["elements"][number]["handle"];
// The decoder reads these fields only; the op's full metadata carries more.
const metadata = (patch: Partial<Psc1Metadata> = {}): Psc1Metadata =>
  ({
    format: "space-scene-v1",
    stamp: { frame: "host-internal-ft" } as Psc1Metadata["stamp"],
    bounds: BOX,
    triangles: 2,
    elements: [
      {
        handle: handle(1),
        categoryId: -2008000,
        firstVertex: 0,
        vertexCount: 3,
        focus: true,
        bounds: BOX,
      },
      {
        handle: handle(2, 7),
        categoryId: CATEGORY_IDS.walls,
        firstVertex: 3,
        vertexCount: 3,
        focus: false,
        bounds: BOX,
      },
    ],
    ...patch,
  }) as Psc1Metadata;
/** A PSC1 artifact: magic, u32 length, metadata JSON, pad to 4, float32 xyz. */
const psc1 = (meta: Psc1Metadata, floats = meta.triangles * 9, magic = 0x31435350) => {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const offset = Math.ceil((8 + json.length) / 4) * 4;
  const buffer = new ArrayBuffer(offset + floats * 4);
  const view = new DataView(buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, json.length, true);
  new Uint8Array(buffer, 8).set(json);
  new Float32Array(buffer, offset).set(Array.from({ length: floats }, (_, i) => i));
  return buffer;
};

describe("PSC1 decode", () => {
  it("decodes positions and one instance per element, keyed like the spike", () => {
    const { meshes, metadata: meta } = decodeScene(psc1(metadata()));
    expect(meta.triangles).toBe(2);
    expect(meshes.positions).toHaveLength(18);
    expect(meshes.positions[17]).toBe(17);
    // Development prop inspection must not enumerate the geometry buffer or element array.
    expect(Object.keys(meshes)).toEqual(["bounds"]);
    expect(meshes.bounds.maxX).toBe(1);
    expect(meshes.instances).toEqual([
      {
        key: JSON.stringify(["doc-a", null, "u-1"]),
        revitId: 1,
        documentKey: "doc-a",
        linkInstanceId: null,
        uniqueId: "u-1",
        categoryId: -2008000,
        category: "Ducts",
        focus: true,
        firstVertex: 0,
        vertexCount: 3,
      },
      expect.objectContaining({
        key: JSON.stringify(["doc-a", 7, "u-2"]),
        revitId: null,
        linkInstanceId: 7,
        categoryId: CATEGORY_IDS.walls,
      }),
    ]);
  });
  it("carries category identity through translated and misleading display labels", () => {
    const meta = metadata();
    meta.elements[0] = {
      ...meta.elements[0]!,
      categoryId: CATEGORY_IDS.walls,
      handle: { ...handle(1), category: "Murs" },
    };
    meta.elements[1] = {
      ...meta.elements[1]!,
      categoryId: 123456,
      handle: { ...handle(2, 7), category: "Walls" },
    };
    const { meshes } = decodeScene(psc1(meta));
    const [wall, unknown] = meshes.instances;
    const layers = { ...LOOK.defaults.layers, context: "walls" as const };
    expect(wall?.category).toBe("Murs");
    expect(contextVisible(wall!.categoryId, "context", layers)).toBe(true);
    expect(unknown?.category).toBe("Walls");
    expect(contextVisible(unknown!.categoryId, "context", layers)).toBe(false);
  });
  it("normalizes absent or null category metadata without inferring IDs from names", () => {
    const meta = metadata();
    delete meta.elements[0]!.categoryId;
    meta.elements[1]!.categoryId = null;
    const { meshes } = decodeScene(psc1(meta));
    expect(meshes.instances.map((instance) => instance.categoryId)).toEqual([null, null]);
  });
  it("rejects malformed category identity in artifact metadata", () => {
    for (const categoryId of ["-2000011", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const meta = metadata();
      Object.assign(meta.elements[0]!, { categoryId });
      expect(() => decodeScene(psc1(meta))).toThrow("category id");
    }
  });
  it("refuses what is not a PSC1 scene in the host frame", () => {
    expect(() => decodeScene(psc1(metadata(), 18, 0))).toThrow("Not a PSC1");
    expect(() => decodeScene(new ArrayBuffer(4))).toThrow("Not a PSC1");
    expect(() =>
      decodeScene(psc1(metadata({ stamp: { frame: "survey" } as Psc1Metadata["stamp"] }))),
    ).toThrow("frame");
    expect(() => decodeScene(psc1(metadata(), 9))).toThrow("vertex budget");
  });
  it("refuses element ranges that skip, overlap or leave triangles unowned", () => {
    const [a, b] = metadata().elements;
    expect(() =>
      decodeScene(psc1(metadata({ elements: [a!, { ...b!, firstVertex: 6 }] }))),
    ).toThrow("range");
    expect(() =>
      decodeScene(psc1(metadata({ elements: [a!, { ...b!, vertexCount: 4 }] }))),
    ).toThrow("range");
    expect(() => decodeScene(psc1(metadata({ elements: [a!] })))).toThrow("Incomplete");
  });
});
