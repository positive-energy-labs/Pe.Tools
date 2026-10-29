import { expect, it } from "vite-plus/test";
import { detailOf, isConsequence, presentIds, takenClosures, tierCounts, tierOf } from "./tiers";

const blocker = (
  closer: "default" | "heal" | "ruling",
  kind: "open-end" | "inferred-join" | "shared-leg" = "shared-leg",
) => ({
  id: `x:1`,
  kind,
  elementId: 1,
  effectInWg: null,
  closer,
});
const pair: [string, string] = ["1:1", "2:0"];

it("maps closer kinds to consent tiers: heal previews, ruling and default are accepted", () => {
  expect(tierOf(blocker("heal", "inferred-join"))).toBe("preview");
  expect(tierOf(blocker("ruling"))).toBe("accept");
  expect(tierOf(blocker("default"))).toBe("accept");
  expect(tierOf({ kind: "inferred-join", closer: { kind: "heal", note: "" } })).toBe("preview");
});

it("an open end previews only with a heal candidate; otherwise it is ruled in Revit under accept", () => {
  expect(tierOf(blocker("ruling", "open-end"))).toBe("accept");
  expect(tierOf(blocker("default", "open-end"))).toBe("accept");
  expect(tierOf({ ...blocker("heal", "open-end"), proposal: { pair } as never })).toBe("preview");
  expect(
    tierOf({
      kind: "open-end",
      closer: {
        kind: "heal",
        note: "",
        candidate: { toElementId: 2, toConnector: 0, gapIn: 0.5, pair },
      },
    }),
  ).toBe("preview");
  expect(tierOf({ kind: "open-end", closer: { kind: "heal", note: "" } })).toBe("accept");
});

it("counts every tier, zero included, over compact and detailed rows alike", () => {
  expect(
    tierCounts([blocker("heal", "inferred-join"), detailOf(blocker("ruling")), blocker("ruling")]),
  ).toEqual({
    taken: 0,
    accept: 2,
    preview: 1,
  });
  expect(tierCounts([])).toEqual({ taken: 0, accept: 0, preview: 0 });
});

it("reads the engine's silent closures from the inputs provenance as taken", () => {
  expect(
    takenClosures([
      { name: "auto-joined 1:1 to 2:0 across 0.500 in", value: null, source: "default auto-join" },
      { name: "terminal drop in-wg", value: 0.04, source: "firm default firm-1" },
      { name: "terminal drop in-wg", value: 0.05, source: "route settings terminal drop" },
      { name: "SHIM terminal drop in-wg", value: 0.03, source: "SHIM placeholder" },
      { name: "split policy", value: "even", source: "typed" },
    ]),
  ).toEqual([
    "auto-joined 1:1 to 2:0 across 0.500 in",
    "terminal drop in-wg 0.04 (firm default firm-1)",
    "terminal drop in-wg 0.05 (route settings terminal drop)",
  ]);
});

it("R-B: a consequence of an assumed heal nests under its cause and takes no tier; an orphan stands alone", () => {
  const cause = { ...blocker("heal", "open-end"), id: "open-end:1:0", proposal: { pair } as never };
  const effect = { ...blocker("ruling"), id: "no-flow:9", elementId: 9, causedBy: "open-end:1:0" };
  const orphan = { ...blocker("ruling"), id: "no-flow:8", elementId: 8, causedBy: "open-end:7:0" };
  expect(tierCounts([cause, effect])).toEqual({ taken: 0, accept: 0, preview: 1 });
  expect(tierCounts([cause, effect, orphan])).toEqual({ taken: 0, accept: 1, preview: 1 });
  expect(isConsequence(effect, presentIds([cause, effect]))).toBe(true);
  expect(isConsequence(orphan, presentIds([cause, effect, orphan]))).toBe(false);
});
