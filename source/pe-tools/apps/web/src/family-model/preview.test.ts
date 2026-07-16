import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  buildFamilyModelPreview,
  centeredLinearTotal,
  familyModelCylinderBounds,
  familyModelPlaneOffset,
  familyModelPrismFaceCoordinate,
  parseFamilyModel,
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
  });
});
