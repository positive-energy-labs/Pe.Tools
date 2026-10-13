import { describe, expect, it } from "vite-plus/test";
import { admittedDestination, CATALOGUE, matchingTools, routeKey, routePath } from "./model";

describe("global navigation admission and catalogue", () => {
  it("admits an explicit same-origin destination without inventing target or thread state", () => {
    expect(admittedDestination("/family", "https://tools.example")).toBe("/family");
    expect(
      admittedDestination("https://tools.example/pea?thread=chosen", "https://tools.example"),
    ).toBe("/pea?thread=chosen");
    expect(admittedDestination("https://other.example/family", "https://tools.example")).toBeNull();
    expect(admittedDestination("javascript:alert(1)", "https://tools.example")).toBeNull();
  });
  it("retains engineering and exploration routes in one searchable catalogue", () => {
    expect(new Set(CATALOGUE.map((tool) => tool.to)).size).toBe(19);
    expect(CATALOGUE.some((tool) => tool.to === "/ops")).toBe(true);
    expect(matchingTools("airflow calculator").some((tool) => tool.to === "/duct-loss")).toBe(true);
    expect(matchingTools("CHAT").some((tool) => tool.to === "/pea")).toBe(true);
  });
  it("maps public product addresses to the existing persisted identity", () => {
    expect(routeKey("/pea")).toBe("chat");
    expect(routeKey("/open")).toBe("instances");
    expect(routePath("chat")).toBe("/pea");
    expect(routePath("instances")).toBe("/open");
    expect(routePath("index")).toBe("/");
  });
});
