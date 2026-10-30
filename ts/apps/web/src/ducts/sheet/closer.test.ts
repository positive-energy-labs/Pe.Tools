import { expect, it } from "vite-plus/test";
import { fittingPricingSchema, type FittingPricing } from "@pe/agent-contracts";
import { describeCloser, type CloserContext } from "./closer";
import { detailOf, type SheetBlocker } from "./tiers";

const context: CloserContext = {
  terminalDrop: { value: 0.03, source: "firm", ref: "seed" },
  nameOf: (id) => (id === 2 ? "14×10 duct" : null),
  wait: null,
};
const pair: [string, string] = ["1:1", "2:0"];
const candidate = { toElementId: 2, toConnector: 0, gapIn: 0.5, pair };
const row = (over: Partial<SheetBlocker>): SheetBlocker => ({
  id: "x:1",
  kind: "open-end",
  elementId: 1,
  effectInWg: null,
  detail: "",
  closer: { kind: "ruling", note: "" },
  ...over,
});

it("an open end heals toward its named candidate as a ruling, with 'rule capped' beside it; without a candidate it is ruled capped", () => {
  const cap = { kind: "cap", end: { elementId: 1, connector: 1 } };
  const healed = describeCloser(
    row({ connector: 1, closer: { kind: "heal", note: "", candidate } }),
    null,
    context,
  );
  expect(healed).toMatchObject({
    verb: "heal → 14×10 duct",
    refusal: null,
    action: { kind: "rule", pair },
    secondary: { verb: "rule capped", refusal: null, action: cap },
  });
  // R-CAP: no candidate is no longer "rule in Revit"; the person caps it on the page.
  const bare = describeCloser(row({ connector: 1 }), null, context);
  expect(bare).toMatchObject({ verb: "rule capped", refusal: null, action: cap, secondary: null });
  // The roster-names-no-inlet open end has no connector to cap.
  const noConnector = describeCloser(row({}), null, context);
  expect(noConnector.verb).toBe("rule in Revit");
  expect(noConnector.refusal).toMatch(/rule the open end in Revit/);
  expect(noConnector.action).toBeNull();
  const waiting = describeCloser(row({ connector: 1 }), null, {
    ...context,
    wait: "Reading inputs detail",
  });
  expect(waiting.refusal).toBe("Reading inputs detail");
});

it("a join names the candidate it accepts and never a raw id alone", () => {
  const join = describeCloser(
    row({
      kind: "inferred-join",
      closer: { kind: "heal", note: "", candidate: { ...candidate, toElementId: 7 } },
    }),
    null,
    context,
  );
  expect(join.verb).toBe("accept join → element 7");
});

it("an unknown drop takes the typed value, else the firm shim named in the verb", () => {
  const blocker = row({
    kind: "unknown-drop",
    elementId: 5,
    detail: "terminal 5 has no drop",
    closer: { kind: "default", note: "" },
  });
  expect(describeCloser(blocker, null, context)).toMatchObject({
    verb: "set drop 0.03 in-wg (firm seed)",
    refusal: null,
    input: { unit: "in-wg", placeholder: 0.03 },
    action: { kind: "drop", elementId: 5, value: 0.03 },
  });
  expect(describeCloser(blocker, 0.05, context)).toMatchObject({
    verb: "set drop 0.05 in-wg",
    action: { kind: "drop", elementId: 5, value: 0.05 },
  });
  const noShim = { ...context, terminalDrop: null };
  expect(describeCloser(blocker, null, noShim)).toMatchObject({
    refusal: "Type the drop in in-wg",
    action: null,
  });
  // The firm's terminal drop seeds terminals only: a part's unknown drop is typed, never seeded.
  const part = describeCloser({ ...blocker, detail: "equipment has no drop (inline equipment)" }, null, context);
  expect(part).toMatchObject({ refusal: "Type the drop in in-wg", input: { placeholder: null }, action: null });
});

// Parsed through the contract, so a fixture the host could never send fails here.
const census = (over: object): FittingPricing => fittingPricingSchema.parse({
  key: "14513278",
  elementId: 14513278,
  family: "Round Elbow",
  rule: null,
  table: null,
  ruleSource: "none",
  tableSource: null,
  options: [],
  candidates: [
    { rule: "elbow-1d-le10", words: "Round Elbow 1 D · D ≤ 10 in", tables: ["CD3-2", "CD3-21"] },
    {
      rule: "elbow-15d-45-le10",
      words: "Round Elbow 1.5 D die stamped · 45 degrees, D ≤ 10 in",
      tables: ["CD3-3", "CD3-1"],
    },
  ],
  lossInWg: null,
  unpriced: "no rule matches fitting Elbow (Round Elbow)",
  typed: null,
  ...over,
}) as FittingPricing;
const fittings = (...rows: FittingPricing[]): CloserContext => ({
  ...context,
  fittingOf: (key) => rows.find((r) => r.key === key) ?? null,
});

it("a not-priced elbow offers 'price with <table>' for its family's rules; the default table writes only the rule", () => {
  const blocker = row({
    id: "not-priced:14513278",
    kind: "not-priced",
    elementId: 14513278,
    fitting: "14513278",
  });
  const closer = describeCloser(blocker, null, fittings(census({})));
  expect(closer).toMatchObject({ verb: "price with…", refusal: null, action: null, secondary: null });
  const cd33 = closer.choices!.find((c) => c.verb === "price with CD3-3")!;
  expect(cd33.action).toEqual({
    kind: "price",
    family: "Round Elbow",
    rule: "elbow-15d-45-le10",
    table: null,
  });
  expect(cd33.detail).toContain("every Round Elbow no rule matches");
  // The option says what the table means (its ASHRAE fitting), never "<rule> reads <table>".
  const titled = describeCloser(blocker, null, {
    ...fittings(census({})),
    tableTitles: { "CD3-3": "CD3-3  Elbow, Die Stamped, 45 Degree, r/D = 1.5 (UMC 1985, Report SRF785)" },
  });
  expect(titled.choices!.find((c) => c.verb === "price with CD3-3")!.detail).toMatch(
    /^Elbow, Die Stamped, 45 Degree, r\/D = 1\.5 · as /,
  );
  // A rule's other table also swaps that rule's table, and the verb's detail says so.
  expect(closer.choices!.find((c) => c.verb === "price with CD3-1")!.action).toMatchObject({
    rule: "elbow-15d-45-le10",
    table: "CD3-1",
  });
  // Typed is the fallback beside the choice: the element's own drop.
  expect(describeCloser(blocker, 0.07, fittings(census({}))).secondary).toMatchObject({
    verb: "set drop 0.07 in-wg",
    action: { kind: "drop", elementId: 14513278, value: 0.07, terminal: false },
  });
  // A matched rule whose table was refused swaps the table instead.
  const matched = describeCloser(
    blocker,
    null,
    fittings(census({ rule: "elbow-1d-le10", ruleSource: "matched", table: "CD3-2", options: ["CD3-2", "CD3-21"] })),
  );
  expect(matched.choices!.map((c) => c.action)).toEqual([
    { kind: "table", rule: "elbow-1d-le10", table: "CD3-21" },
  ]);
});

it("a proposed fitting's path takes a typed drop for that path only, with no default seed", () => {
  const key = "proposed:14106988:1|14122436:1>14106988";
  const blocker = row({
    id: "not-priced:14122436:1",
    kind: "not-priced",
    elementId: 14122436,
    connector: 1,
    fitting: key,
  });
  const join = census({
    key,
    elementId: null,
    family: "proposed join",
    candidates: [],
    proposed: { pair: ["14122436:1", "14106988:1"], kind: "join", path: "branch", toward: 14106988 },
  });
  const blank = describeCloser(blocker, null, fittings(join));
  expect(blank).toMatchObject({
    verb: "set path drop",
    refusal: "No table prices this path; type its drop in in-wg",
    input: { unit: "in-wg", placeholder: null },
    action: null,
  });
  expect(describeCloser(blocker, 0.04, fittings(join))).toMatchObject({
    verb: "set path drop 0.04 in-wg → element 14106988",
    refusal: null,
    action: { kind: "pathDrop", key, value: 0.04 },
  });
  // A proposed tee whose takeoff table is refused is priced with a table first, typed beside it.
  const tee = describeCloser(
    blocker,
    0.04,
    fittings(census({
      ...join,
      family: "proposed tee",
      proposed: { ...join.proposed!, kind: "tee" },
      candidates: [{ rule: "tap-std", words: "Round Takeoff Standard", tables: ["SD5-9"] }],
    })),
  );
  expect(tee.choices!.map((c) => c.action)).toEqual([
    { kind: "price", family: "proposed tee", rule: "tap-std", table: null },
  ]);
  expect(tee.secondary).toMatchObject({ action: { kind: "pathDrop", key, value: 0.04 } });
});

it("no-flow is refused until a cfm is typed, then sets the end's cfm", () => {
  const blocker = detailOf({
    id: "no-flow:3",
    kind: "no-flow",
    elementId: 3,
    effectInWg: null,
    closer: "default",
  });
  expect(describeCloser(blocker, null, context)).toMatchObject({
    verb: "set flow",
    refusal: "Type the cfm",
    input: { unit: "cfm" },
  });
  expect(describeCloser(blocker, 400, context)).toMatchObject({
    verb: "set flow 400 cfm",
    refusal: null,
    action: { kind: "cfm", elementId: 3, value: 400 },
  });
});

it("the sheet-wide wait refuses every live verb and a noteless ruling says why", () => {
  const waiting = { ...context, wait: "Reading inputs detail" };
  expect(
    describeCloser(row({ closer: { kind: "heal", note: "", candidate } }), null, waiting).refusal,
  ).toBe("Reading inputs detail");
  const shared = describeCloser(
    row({ kind: "shared-leg", closer: { kind: "ruling", note: "rule the stops between" } }),
    null,
    context,
  );
  expect(shared).toMatchObject({
    verb: "rule shared-leg",
    refusal: "rule the stops between",
    action: null,
  });
});

it("a class crossing is a second framed verb naming the air classes, ordered first when nearer", () => {
  const crossing = {
    toElementId: 2,
    toConnector: 0,
    distanceIn: 0.01,
    classes: ["ReturnAir", "SupplyAir"] as [string, string],
    pair: ["1:0", "2:0"] as [string, string],
  };
  const near = describeCloser(
    row({
      connector: 0,
      closer: {
        kind: "heal",
        note: "",
        candidate: { ...candidate, toElementId: 9, gapIn: 0.5 },
        crossing,
      },
    }),
    null,
    context,
  );
  expect(near.verb).toBe("heal → element 9");
  expect(near.crossing).toMatchObject({
    verb: "accept join → 14×10 duct (crosses ReturnAir→SupplyAir air)",
    refusal: null,
    action: { kind: "rule", pair: crossing.pair },
    distanceIn: 0.01,
    first: true,
  });
  const far = describeCloser(
    row({
      connector: 0,
      closer: {
        kind: "heal",
        note: "",
        candidate: { ...candidate, toElementId: 9, gapIn: 0.001 },
        crossing,
      },
    }),
    null,
    context,
  );
  expect(far.crossing?.first).toBe(false);
});

it("a side-stream unit's no-flow row sets the unit's design flow, one number for every receiving end", () => {
  const blocker = row({
    id: "no-flow:6105264:4",
    kind: "no-flow",
    elementId: 6105264,
    detail:
      "the fan's own flow splits across 3 receiving fan/merge ends; no unit design flow or complete typed shares are available",
  });
  const withFan = { ...context, fan: { unitId: 14577391, name: "MUAS-1" } };
  expect(describeCloser(blocker, null, withFan)).toMatchObject({
    verb: "set MUAS-1 design flow",
    refusal: "Type the unit's design cfm",
  });
  expect(describeCloser(blocker, 500, withFan)).toMatchObject({
    verb: "set MUAS-1 design flow 500 cfm",
    refusal: null,
    action: { kind: "unitCfm", unitId: 14577391, value: 500 },
  });
  // A terminal's own no-flow still types that terminal's cfm.
  const terminal = row({
    id: "no-flow:9:1",
    kind: "no-flow",
    elementId: 9,
    detail: "terminal 9 has no revit:Flow value",
  });
  expect(describeCloser(terminal, 120, withFan).action).toEqual({
    kind: "cfm",
    elementId: 9,
    value: 120,
  });
});

it("a no-flow row at another unit's port sets that unit's design flow, never a per-end flows cell", () => {
  // Chadds MUAS-1 14577391:2 (UAT 2026-10-29): typed 1000 cfm under a 1120 cfm intake leaves no
  // remainder for the four ERV ports; `work.flows` is read for terminals only, so "set flow" on
  // RV-30's port wrote a cell the resolver never reads.
  const blocker = row({
    id: "no-flow:12777429:4",
    kind: "no-flow",
    elementId: 12777429,
    connector: 4,
    detail: "typed end cfm exceeds the unit design flow; no nonnegative remainder to split",
  });
  const receiving = (end: { elementId: number; connector?: number }) =>
    end.elementId === 12777429 && end.connector === 4 ? { unitId: 12777429, name: "RV-30" } : null;
  const withUnits = { ...context, fan: { unitId: 14577391, name: "MUAS-1" }, receiving };
  expect(describeCloser(blocker, null, withUnits)).toMatchObject({
    verb: "set RV-30 design flow",
    refusal: "Type the unit's design cfm",
    input: { unit: "cfm" },
  });
  expect(describeCloser(blocker, 100, withUnits)).toMatchObject({
    verb: "set RV-30 design flow 100 cfm",
    refusal: null,
    action: { kind: "unitCfm", unitId: 12777429, value: 100 },
  });
});
