import { describe, expect, it } from "vite-plus/test";

import { parseLoadPreview } from "./load-preview.ts";

const row = (...cells: (string | number)[]) => cells.join("\t");
/** The load tool's own layout: name, Area, Sen Gain, Lat Gain, Net Gain, Sen Loss, Air Flow, Load/Area, Airflow/Area. */
const PASTE = [
  row("Paste your clipboard here"),
  row("Building", 9000, 60000, 12000, 72000, 80000, 3400, 8, 0.38),
  row("System 1 Lab North AH-2", 1200, 8000, 1500, 9500, 11000, 600, 7.9, 0.5),
  row("Ventilation", "", 500, 900, 1400, 600, 60),
  row("Misc. Return", "", 0, "-450", "-450"),
  row("Zone 1", 1200, 7500, 600, 8100, 10400, 600),
  row("1-Lab 101", 700, 4500, 400, 4900, 6000, 350),
  row("2-Prep", 500, 3000, 200, 3200, 4400, 250),
  "",
  row("System 2 Offices", 800, 5000, 900, 5900, 7000, "1,000"),
  row("Zone 1", 800, 4800, 300, 5100, 6800, 400),
  row("3-Office 204A", 800, 4800, 300, 5100, 6800, 400),
  "",
  row("System 3 Lobby EF-1A", 300, 2000, 300, 2300, 2500, ""),
  row("4-Lobby 001", 300, 2000, 300, 2300, 2500, 150),
].join("\r\n");

describe("parseLoadPreview", () => {
  it("reads systems, tags, room numbers and flows from the load tool's layout", () => {
    const { systems, findings } = parseLoadPreview(PASTE);
    expect(systems.map((s) => [s.name, s.tag, s.cfm])).toEqual([
      ["System 1 Lab North AH-2", "AH-2", 600],
      ["System 2 Offices", null, 1000],
      ["System 3 Lobby EF-1A", "EF-1A", null],
    ]);
    expect(systems[0]!.rooms).toEqual([
      { name: "1-Lab 101", number: "101", cfm: 350 },
      { name: "2-Prep", number: null, cfm: 250 },
    ]);
    expect(systems[1]!.rooms).toEqual([{ name: "3-Office 204A", number: "204A", cfm: 400 }]);
    expect(findings).toEqual([
      { kind: "no-cfm-column", line: 3, text: "System 1 Lab North AH-2" },
      { kind: "no-tag", line: 10, text: "System 2 Offices" },
      { kind: "no-cfm", line: 14, text: "System 3 Lobby EF-1A" },
    ]);
  });

  it("takes the flow column from a header row when one is pasted", () => {
    const text = [
      row("Scope", "Net Ton", "Area", "Sys Htg CFM", "Sys Act CFM"),
      row("System 4 Gym FC-3", 0.5, 900, 700, 650),
      row("5-Gym 010", "", 900, 700, 650),
    ].join("\n");
    const { systems, findings } = parseLoadPreview(text);
    expect(systems).toEqual([
      {
        name: "System 4 Gym FC-3",
        tag: "FC-3",
        cfm: 650,
        rooms: [{ name: "5-Gym 010", number: "010", cfm: 650 }],
      },
    ]);
    expect(findings).toEqual([]);
  });
});
