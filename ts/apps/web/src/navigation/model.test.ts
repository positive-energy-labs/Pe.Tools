import { describe, expect, it } from "vite-plus/test";
import { SURFACE_SHELLS } from "@pe/agent-contracts";
import {
  admittedDestination,
  CATALOGUE,
  matchingTools,
  routeKey,
  routePath,
  shellButtons,
} from "./model";

describe("global navigation admission and catalogue", () => {
  it("admits an explicit same-origin destination without inventing target or thread state", () => {
    expect(admittedDestination("/family", "https://tools.example")).toBe("/family");
    expect(
      admittedDestination("https://tools.example/pea?thread=chosen", "https://tools.example"),
    ).toBe("/pea?thread=chosen");
    expect(admittedDestination("https://other.example/family", "https://tools.example")).toBeNull();
    expect(admittedDestination("javascript:alert(1)", "https://tools.example")).toBeNull();
    for (const path of [
      "/unknown",
      "/pe/navigation",
      "/api/pdf-audit/parse",
      "/pages/example/",
      "/family/unknown",
    ])
      expect(admittedDestination(path, "https://tools.example")).toBeNull();
    expect(admittedDestination("/bind", "https://tools.example")).toBe("/bind");
    expect(admittedDestination("/design-system/revit#specimen", "https://tools.example")).toBe(
      "/design-system/revit#specimen",
    );
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
  it("draws Home and the shell's icons, pressing the location only where no picker shows it", () => {
    const pressed = (surface: keyof typeof SURFACE_SHELLS, path: string) =>
      shellButtons(SURFACE_SHELLS[surface], path).map(
        (button) => `${button.label}${button.pressed ? "*" : ""}`,
      );
    expect(pressed("tray", "/pea")).toEqual(["Home / open work", "Pea Inbox*", "Machine"]);
    expect(pressed("tray", "/open")).toEqual(["Home / open work*", "Pea Inbox", "Machine"]);
    expect(pressed("tray", "/machine")).toEqual(["Home / open work", "Pea Inbox", "Machine*"]);
    expect(pressed("web", "/pea")).toEqual(["Home / tool directory", "Open Pea"]);
    expect(pressed("pwa", "/")).toEqual(["Home / tool directory", "Open Pea"]);
    expect(shellButtons(SURFACE_SHELLS.tray, "/pea")[1]?.path).toBe("/pea");
  });
});
