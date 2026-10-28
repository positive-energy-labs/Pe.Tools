import { describe, expect, it } from "vite-plus/test";
import { assertLevels, levelExtents, levelNames, type SceneLevels } from "./levels";

const levels = (): SceneLevels => ({
  sources: [
    {
      source: 0,
      documentKey: "host",
      linkInstanceId: null,
      name: "Host",
      status: "loaded",
      countedLevels: 5,
      unavailableLevelIds: [],
      reason: null,
    },
  ],
  planes: [-8, 0, 10, 20, 1004].map((z, i) => ({
    point: [0, 0, z],
    normal: [0, 0, 1],
    members: [
      {
        source: 0,
        elementId: i + 1,
        uniqueId: `level-${i}`,
        name: `Level ${i}`,
        projectElevationFt: z,
        buildingStory: true,
      },
    ],
  })),
  work: { nativeMilliseconds: 0, startPrivateBytes: 0, endPrivateBytes: 0 },
});

describe("measured levels in the picture", () => {
  it("draws the nearest enclosing datums in host feet without fitting a distant stray into the camera", () => {
    const data = levels();
    const bounds = { minX: 1400, maxX: 1450, minY: 1700, maxY: 1750, minZ: 2, maxZ: 12 };
    expect(levelExtents(data, bounds).map((p) => p.z)).toEqual([0, 10, 20]);
    expect(levelExtents(data, bounds)[1]!.corners).toEqual([
      [1400, 1700, 10],
      [1450, 1700, 10],
      [1450, 1750, 10],
      [1400, 1750, 10],
    ]);
    expect(data.planes.at(-1)!.point[2]).toBe(1004);
  });
  it("keeps coincident names and source membership while drawing a single plane", () => {
    const data = levels();
    data.planes[1]!.members.push({ ...data.planes[1]!.members[0]!, elementId: 99, name: "Ground" });
    expect(levelNames(data.planes[1]!)).toBe("Level 1 / Ground");
    expect(data.planes[1]!.members).toHaveLength(2);
    expect(() => assertLevels(data)).not.toThrow();
  });
  it("refuses invalid native frames and broken provenance before drawing", () => {
    const frame = levels();
    frame.planes[0]!.normal = [0, 0, 0];
    expect(() => assertLevels(frame)).toThrow("plane");
    const source = levels();
    source.planes[0]!.members[0]!.source = 7;
    expect(() => assertLevels(source)).toThrow("plane");
  });
});
