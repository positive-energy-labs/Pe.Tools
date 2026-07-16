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
});
