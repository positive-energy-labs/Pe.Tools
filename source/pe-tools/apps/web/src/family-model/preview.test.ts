import { describe, expect, it } from "vite-plus/test";

import { buildFamilyModelPreview, parseFamilyModel } from "./preview";

describe("family model preview", () => {
  it("resolves type values, portable lengths, formulas, and named constituents", () => {
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

    expect(preview.parameters.Height).toBe(36);
    expect(preview.solids[0]).toMatchObject({ width: 12, depth: 6, height: 72 });
    expect(
      preview.constituents.find((group) => group.label === "Connectors")?.items[0],
    ).toMatchObject({
      name: "supply",
      facts: expect.arrayContaining(["frame:supply", "Ø 6in", "stub Out 1in solid"]),
    });
    expect(
      preview.constituents.find((group) => group.label === "Frames")?.items[0].facts,
    ).toContain("origin face:body.Front ∩ plane:family.CenterLeftRight ∩ plane:family.RefLevel");
    expect(preview.warnings).toEqual([]);
  });

  it("warns instead of guessing solids in unsupported spatial frames", () => {
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

    expect(preview.solids).toEqual([]);
    expect(preview.warnings).toContain("Spatial frame not previewed: offset uses frame:offset");
  });
});
