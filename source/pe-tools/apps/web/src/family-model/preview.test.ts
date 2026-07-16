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
          connectors: { supply: { domain: "Duct", shape: "Round", frame: "frame:supply" } },
        }),
      ),
      "Tall",
    );

    expect(preview.parameters.Height).toBe(36);
    expect(preview.solids[0]).toMatchObject({ width: 12, depth: 6, height: 72 });
    expect(preview.groups.find((group) => group.label === "Connectors")?.names).toEqual(["supply"]);
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
