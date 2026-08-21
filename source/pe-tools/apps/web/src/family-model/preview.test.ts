import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  buildFamilyModelPreview,
  centeredLinearTotal,
  familyModelAngleDegrees,
  familyModelApply,
  familyModelCylinderBounds,
  familyModelFamilyPlane,
  familyModelFrameBasis,
  familyModelIntersectPlanes,
  familyModelLengthFeet,
  familyModelPlaneOffset,
  familyModelPolygonBounds,
  familyModelPrismFaceCoordinate,
  familyModelRotate,
  familyModelRotationAxis,
  parseFamilyModel,
  type FamilyModelVector,
} from "./preview";

describe("family model preview", () => {
  it("preserves authored overrides, formulas, references, and constituent facts", () => {
    const preview = buildFamilyModelPreview(
      parseFamilyModel(
        JSON.stringify({
          family: {
            name: "Box",
            category: "Generic Models",
            template: "Generic Model",
            placement: "Unhosted",
          },
          familyParameters: {
            Width: { value: "12in" },
            Height: { value: "6in" },
            "Double Height": { formula: "Height * 2" },
          },
          types: { Default: {}, Tall: { Height: "3ft" } },
          solids: {
            body: {
              kind: "Prism",
              frame: "frame:family",
              width: "param:Width",
              depth: "1/2ft",
              height: "param:Double Height",
            },
          },
          frames: {
            supply: {
              origin: ["face:body.Front", "plane:family.CenterLeftRight", "plane:family.RefLevel"],
              normal: "+Y",
              up: "+Z",
            },
          },
          connectors: {
            supply: {
              domain: "Duct",
              shape: "Round",
              frame: "frame:supply",
              diameter: "6in",
              stub: { depth: "1in", direction: "Out", isSolid: true },
              systemType: "SupplyAir",
            },
          },
        }),
      ),
      "Tall",
    );

    expect(preview.parameters.find((parameter) => parameter.name === "Height")).toEqual({
      name: "Height",
      authored: "3ft",
      origin: "Tall override",
    });
    expect(
      preview.parameters.find((parameter) => parameter.name === "Double Height")?.authored,
    ).toBe("= Height * 2");
    expect(
      preview.constituents.find((group) => group.label === "Connectors")?.items[0],
    ).toMatchObject({
      name: "supply",
      facts: expect.arrayContaining(["frame:supply", "Ø 6in", "stub Out 1in solid"]),
    });
    expect(
      preview.constituents.find((group) => group.label === "Frames")?.items[0].facts,
    ).toContain("origin face:body.Front ∩ plane:family.CenterLeftRight ∩ plane:family.RefLevel");
  });

  it("shows authored spatial frames without inferring geometry", () => {
    const preview = buildFamilyModelPreview(
      parseFamilyModel(
        JSON.stringify({
          family: {
            name: "Offset",
            category: "Generic Models",
            template: "Generic Model",
            placement: "Unhosted",
          },
          solids: {
            offset: {
              kind: "Prism",
              frame: "frame:offset",
              width: "12in",
              depth: "8in",
              height: "6in",
            },
          },
        }),
      ),
    );

    expect(preview.constituents.find((group) => group.label === "Solids")?.items[0].facts).toEqual([
      "Prism",
      "frame:offset",
      "W 12in",
      "D 8in",
      "H 6in",
    ]);
    expect(preview.warnings).toEqual([]);
  });

  it("matches the shared dumb-evaluator conformance vectors", () => {
    const path = new URL(
      "../../../../../Pe.Revit.Tests/Fixtures/Profiles/family-model-evaluator.conformance.json",
      import.meta.url,
    );
    const vectors = JSON.parse(readFileSync(path, "utf8")) as {
      planes: Array<{ direction: "In" | "Out"; distance: number; coordinate: number }>;
      prism: {
        width: number;
        depth: number;
        height: number;
        faces: Record<string, number>;
      };
      cylinder: {
        diameter: number;
        height: number;
        bounds: Record<"x" | "y" | "z", [number, number]>;
      };
      frame: {
        coordinate: Record<"x" | "y" | "z", number>;
      };
      centeredLinear: Array<{ halfCount: number; total: number }>;
      familyPlanes: Record<string, { axis: string; outward: FamilyModelVector }>;
      frameOrigin: {
        planes: Array<{ point: FamilyModelVector; normal: FamilyModelVector }>;
        point: FamilyModelVector;
      };
      frameTransforms: Array<{
        case: string;
        origin: FamilyModelVector;
        normal: string;
        up: string;
        rotation?: { about: string; by: string };
        parametersInRadians?: Record<string, number>;
        local: FamilyModelVector;
        world: FamilyModelVector;
      }>;
      polygons: Array<{
        case: string;
        profile: Array<{ x: string; y: string }>;
        height: string;
        parametersInFeet: Record<string, number>;
        bounds: Record<"x" | "y" | "z", [number, number]>;
      }>;
    };

    for (const vector of vectors.planes) {
      expect(familyModelPlaneOffset(vector.direction, vector.distance)).toBe(vector.coordinate);
    }
    for (const [face, coordinate] of Object.entries(vectors.prism.faces)) {
      expect(
        familyModelPrismFaceCoordinate(
          face,
          vectors.prism.width,
          vectors.prism.depth,
          vectors.prism.height,
        )?.coordinate,
      ).toBe(coordinate);
    }
    expect(familyModelCylinderBounds(vectors.cylinder.diameter, vectors.cylinder.height)).toEqual(
      vectors.cylinder.bounds,
    );
    expect({
      x: 0,
      y: familyModelPrismFaceCoordinate(
        "Front",
        vectors.prism.width,
        vectors.prism.depth,
        vectors.prism.height,
      )?.coordinate,
      z: familyModelPlaneOffset("Out", vectors.planes[0].distance),
    }).toEqual(vectors.frame.coordinate);
    for (const vector of vectors.centeredLinear) {
      expect(centeredLinearTotal(vector.halfCount)).toBe(vector.total);
    }
    for (const [member, expected] of Object.entries(vectors.familyPlanes)) {
      const plane = familyModelFamilyPlane(member);
      expect(plane?.axis).toBe(expected.axis.toLowerCase());
      expect(plane?.outward).toEqual(expected.outward);
    }
    expectClose(familyModelIntersectPlanes(vectors.frameOrigin.planes), vectors.frameOrigin.point);
    for (const vector of vectors.frameTransforms) {
      let frame = familyModelFrameBasis(vector.origin, vector.normal, vector.up);
      if (vector.rotation) {
        frame = familyModelRotate(
          frame,
          familyModelRotationAxis(vector.rotation.about, frame),
          familyModelAngleDegrees(vector.rotation.by, vector.parametersInRadians ?? {}),
        );
      }
      expectClose(familyModelApply(frame, vector.local), vector.world, vector.case);
    }
    for (const vector of vectors.polygons) {
      const profile = vector.profile.map((point) => ({
        x: familyModelLengthFeet(point.x, vector.parametersInFeet),
        y: familyModelLengthFeet(point.y, vector.parametersInFeet),
      }));
      const bounds = familyModelPolygonBounds(
        profile,
        familyModelLengthFeet(vector.height, vector.parametersInFeet),
      );
      for (const axis of ["x", "y", "z"] as const) {
        expect(bounds[axis][0], `${vector.case} ${axis} min`).toBeCloseTo(
          vector.bounds[axis][0],
          9,
        );
        expect(bounds[axis][1], `${vector.case} ${axis} max`).toBeCloseTo(
          vector.bounds[axis][1],
          9,
        );
      }
    }
  });
});

function expectClose(actual: FamilyModelVector, expected: FamilyModelVector, context = "") {
  for (const component of [0, 1, 2] as const) {
    expect(actual[component], `${context} [${component}]`).toBeCloseTo(expected[component], 9);
  }
}
