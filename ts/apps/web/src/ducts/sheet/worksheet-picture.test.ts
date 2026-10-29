// @vitest-environment jsdom
/** The worksheet as picture content: strands in air order, critical heavy, over legs, section widen. */
import { expect, it } from "vite-plus/test";
import type { Detail } from "./api";
import { worksheetPicture } from "./picture";

const leg = (id: string, elementId: number) => ({
  id,
  elementId,
  kind: "duct" as const,
  flowCfm: 100,
  flowSource: null,
  velocityFpm: 800,
  lossInWg: 0.01,
  lossSource: { kind: "friction" as const, ref: "" },
  equivalentFt: null,
});
const run = (id: string, side: "supply" | "return", legIds: string[], critical: boolean, over: string[]) => ({
  id,
  side,
  end: { kind: "terminal" } as never,
  legIds,
  sectionIds: [],
  cfm: 100,
  telFt: 10,
  knownInWg: 0.1,
  complete: true,
  residualInWg: 0,
  critical,
  maxFpm: 800,
  overLegIds: over,
});
const ws = {
  kind: "worksheet",
  target: {} as never,
  basis: "b",
  limits: { supplyFpm: 900, returnFpm: 700, source: "shim" },
  legs: { a: leg("a", 1), b: leg("b", 2), c: leg("c", 3), d: leg("d", 4) },
  supply: {
    runs: [run("s1", "supply", ["a", "b"], false, [])],
    sections: [{ id: "S1", side: "supply", legIds: ["a"], runIds: ["s1"], cfm: 100, knownInWg: 0, unpricedLegs: 0, telFt: 1, maxFpm: 800, overLegIds: [] }],
    worstKnownInWg: 0.1,
    elementSections: { "1": ["S1"] },
  },
  return: {
    runs: [run("r1", "return", ["c", "d"], true, ["d"])],
    sections: [],
    worstKnownInWg: 0.2,
    elementSections: {},
  },
} as unknown as Detail<"worksheet">;

it("runs become strands in air order, the critical one heavy; over legs alarm; a pick widens to its section", () => {
  const p = worksheetPicture(ws);
  expect(p.strands).toEqual([
    { key: "run:s1", path: ["e:1", "e:2"], heavy: false },
    // A return run is walked fan to grille; air flows grille to fan.
    { key: "run:r1", path: ["e:4", "e:3"], heavy: true },
  ]);
  expect([...p.over]).toEqual(["e:4"]);
  expect(p.members.get("section:S1")).toEqual(["e:1"]);
  expect(p.widen!("e:1")).toEqual(["e:1"]);
  expect(p.widen!("e:3")).toEqual([]);
  expect(worksheetPicture(null).strands).toEqual([]);
});
