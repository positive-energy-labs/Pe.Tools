import { describe, expect, it } from "vite-plus/test";

import { buildFamilyModelPreview, parseFamilyModel } from "./preview";

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
});
