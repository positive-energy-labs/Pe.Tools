import { describe, expect, it } from "vite-plus/test";
import { admittedDestination } from "./model";

describe("global navigation admission and catalogue", () => {
  it("admits an explicit same-origin destination without inventing target or thread state", () => {
    expect(admittedDestination("/families", "https://tools.example")).toBe("/families");
    expect(
      admittedDestination("https://tools.example/pea?thread=chosen", "https://tools.example"),
    ).toBe("/pea?thread=chosen");
    expect(
      admittedDestination("https://other.example/families", "https://tools.example"),
    ).toBeNull();
    expect(admittedDestination("javascript:alert(1)", "https://tools.example")).toBeNull();
    for (const path of [
      "/unknown",
      "/pe/navigation",
      "/api/pdf-audit/parse",
      "/pages/example/",
      "/families/unknown",
    ])
      expect(admittedDestination(path, "https://tools.example")).toBeNull();
    expect(admittedDestination("/bind", "https://tools.example")).toBe("/bind");
    expect(admittedDestination("/design-system/revit#specimen", "https://tools.example")).toBe(
      "/design-system/revit#specimen",
    );
  });
});
