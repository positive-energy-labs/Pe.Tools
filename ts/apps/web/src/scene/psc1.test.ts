import { describe, expect, it } from "vite-plus/test";
import { decodeScene, SCENE_FORMAT, type Psc1Metadata } from "./psc1";
import { CATEGORY_IDS } from "./categories";
import { contextVisible } from "./context";
import { LOOK } from "./grounds";

const BOX = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
const FRAME = {
  center: [0.5, 0.5, 0.5],
  axisX: [1, 0, 0],
  axisY: [0, 1, 0],
  axisZ: [0, 0, 1],
  halfSize: [0.5, 0.5, 0.5],
  frame: "symbol" as const,
};
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
    format: SCENE_FORMAT,
    stamp: { frame: "host-internal-ft" } as Psc1Metadata["stamp"],
    bounds: BOX,
    triangles: 2,
    levels: {
      sources: [],
      planes: [],
      work: { nativeMilliseconds: 0, startPrivateBytes: 0, endPrivateBytes: 0 },
    },
    completeness: {
      complete: true,
      deferredCandidates: 0,
      acquisitionLimitedElements: 0,
      limitReason: null,
    },
    elements: [
      {
        handle: handle(1),
        categoryId: -2008000,
        firstVertex: 0,
        vertexCount: 3,
        representation: "mesh",
        focus: true,
        bounds: BOX,
      },
      {
        handle: handle(2, 7),
        categoryId: CATEGORY_IDS.walls,
        firstVertex: 3,
        vertexCount: 3,
        representation: "mesh",
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
  it.each(["symbol", "triangles"] as const)(
    "decodes %s frames without fabricating mesh vertices or losing linked identity",
    (frame) => {
      const elements: Psc1Metadata["elements"] = metadata().elements.map((e) => ({
        ...e,
        firstVertex: 0,
        vertexCount: 0,
        representation: "oriented-box" as const,
        orientedBox: { ...FRAME, frame },
      }));
      elements[0] = {
        ...elements[0]!,
        representation: "run",
        orientedBox: null,
        run: {
          start: [0, 0, 0],
          end: [0, 0, 1],
          shape: "round",
          diameterFt: 1,
          radialSegments: 32,
          radialOverdrawFraction: 1 / (Math.cos(Math.PI / 32) - 2 ** -24) - 1,
          crossSectionXAxis: [1, 0, 0],
        },
      } as Psc1Metadata["elements"][number];
      const { meshes } = decodeScene(psc1(metadata({ triangles: 0, elements })));
      expect(meshes.positions.byteLength).toBe(0);
      expect(meshes.instances[0]).toMatchObject({
        focus: true,
        revitId: 1,
        primitive: { kind: "run", run: { diameterFt: 1 } },
      });
      expect(meshes.instances[1]).toMatchObject({
        revitId: null,
        linkInstanceId: 7,
        primitive: { kind: "oriented-box", bounds: BOX, box: { ...FRAME, frame } },
      });
    },
  );
  it("rejects primitive ranges, invalid bounds and unsized or nonorthogonal runs", () => {
    const box = {
      ...metadata().elements[0]!,
      representation: "oriented-box" as const,
      firstVertex: 0,
      vertexCount: 0,
    };
    const run = {
      start: [0, 0, 0],
      end: [0, 0, 1],
      shape: "rectangular" as const,
      radialSegments: 0,
      radialOverdrawFraction: 0,
      widthFt: 2,
      heightFt: 1,
      crossSectionXAxis: [1, 0, 0],
    };
    const decode = (element: Psc1Metadata["elements"][number]) =>
      decodeScene(
        psc1(
          metadata({
            triangles: 0,
            elements: [
              { ...element, orientedBox: element.representation === "oriented-box" ? FRAME : null },
            ],
          }),
        ),
      );
    expect(() => decode({ ...box, vertexCount: 3 })).toThrow("range");
    expect(() => decode({ ...box, bounds: { ...BOX, maxX: -1 } })).toThrow("bounds");
    expect(() => decode({ ...box, representation: "run", run: { ...run, widthFt: 0 } })).toThrow(
      "dimensions",
    );
    expect(() =>
      decode({ ...box, representation: "run", run: { ...run, crossSectionXAxis: [0, 0, 1] } }),
    ).toThrow("frame");
    expect(() =>
      decode({ ...box, representation: "run", run: { ...run, end: [0, 0, 0] } }),
    ).toThrow("frame");
    expect(() =>
      decode({ ...box, representation: "run", run: { ...run, crossSectionXAxis: [2, 0, 0] } }),
    ).toThrow("frame");
  });
  it("refuses absent, skewed, reflected or bound-inconsistent oriented frames", () => {
    const base = {
      ...metadata().elements[0]!,
      representation: "oriented-box" as const,
      firstVertex: 0,
      vertexCount: 0,
    };
    for (const orientedBox of [
      null,
      { ...FRAME, axisX: [2, 0, 0] },
      { ...FRAME, axisY: [1, 0, 0] },
      { ...FRAME, axisZ: [0, 0, -1] },
      { ...FRAME, halfSize: [0, 1, 1] },
      { ...FRAME, center: [2, 0.5, 0.5] },
    ]) {
      expect(() =>
        decodeScene(psc1(metadata({ triangles: 0, elements: [{ ...base, orientedBox }] }))),
      ).toThrow(/box/);
    }
    expect(() => decodeScene(psc1(metadata({ format: "space-scene-v3" })))).toThrow("outdated");
  });
  it("refuses a centreline sweep in place of native curved geometry", () => {
    const run = {
      start: [0, 0, 0],
      end: [1, 1, 1],
      shape: "round" as const,
      radialSegments: 32,
      radialOverdrawFraction: 1 / (Math.cos(Math.PI / 32) - 2 ** -24) - 1,
      diameterFt: 1,
      crossSectionXAxis: [1, 0, 0],
      path: [
        [0, 0, 0],
        [0, 0, 1],
        [1, 1, 1],
      ],
    };
    const decode = (path: number[][]) =>
      decodeScene(
        psc1(
          metadata({
            triangles: 0,
            elements: [
              {
                ...metadata().elements[0]!,
                firstVertex: 0,
                vertexCount: 0,
                representation: "run",
                orientedBox: null,
                run: Object.assign({}, run, { path }),
              },
            ],
          }),
        ),
      );
    expect(() => decode(run.path)).toThrow("native meshes");
    expect(() =>
      decode([
        [0, 0, 0],
        [0, 0, 1],
        [2, 1, 1],
      ]),
    ).toThrow("native meshes");
    expect(() =>
      decode([
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
      ]),
    ).toThrow("native meshes");
  });
  it("refuses old captures and malformed completeness before they can become cache authority", () => {
    expect(() => decodeScene(psc1(metadata({ format: "space-scene-v1" })))).toThrow("outdated");
    const old = metadata();
    Reflect.deleteProperty(old, "completeness");
    expect(() => decodeScene(psc1(old))).toThrow("outdated");
    const unknownRemaining = metadata({
      completeness: {
        complete: false,
        deferredCandidates: null,
        acquisitionLimitedElements: 0,
        limitReason: "memory-growth",
      },
    });
    expect(decodeScene(psc1(unknownRemaining)).metadata.completeness.deferredCandidates).toBeNull();
    for (const patch of [
      { complete: "true" },
      { deferredCandidates: -1 },
      { acquisitionLimitedElements: 1.5 },
      { limitReason: undefined },
    ]) {
      const malformed = metadata();
      Object.assign(malformed.completeness, patch);
      expect(() => decodeScene(psc1(malformed))).toThrow("completeness");
    }
  });
});
