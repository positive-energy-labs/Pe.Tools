import { expect, it } from "vite-plus/test";
import { describeCloser, type CloserContext } from "./closer";
import { detailOf, type SheetBlocker } from "./tiers";

const context: CloserContext = {
  defaults: {
    terminalDropInWg: 0.03,
    terminalDropSource: "SHIM placeholder",
    autoJoinMaxGapIn: 3,
    splitPolicy: "even",
    basis: "b",
  },
  dropSource: "firm shim",
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
    closer: { kind: "default", note: "" },
  });
  expect(describeCloser(blocker, null, context)).toMatchObject({
    verb: "set drop 0.03 in-wg (firm shim)",
    refusal: null,
    input: { unit: "in-wg", placeholder: 0.03 },
    action: { kind: "drop", elementId: 5, value: 0.03 },
  });
  expect(describeCloser(blocker, 0.05, context)).toMatchObject({
    verb: "set drop 0.05 in-wg",
    action: { kind: "drop", elementId: 5, value: 0.05 },
  });
  const noShim = { ...context, defaults: { ...context.defaults, terminalDropInWg: null } };
  expect(describeCloser(blocker, null, noShim)).toMatchObject({
    refusal: "Type the drop in in-wg",
    action: null,
  });
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
    row({ connector: 0, closer: { kind: "heal", note: "", candidate: { ...candidate, toElementId: 9, gapIn: 0.5 }, crossing } }),
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
    row({ connector: 0, closer: { kind: "heal", note: "", candidate: { ...candidate, toElementId: 9, gapIn: 0.001 }, crossing } }),
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
    detail: "the fan's own flow splits across 3 receiving fan/merge ends; no unit design flow or complete typed shares are available",
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
  const terminal = row({ id: "no-flow:9:1", kind: "no-flow", elementId: 9, detail: "terminal 9 has no revit:Flow value" });
  expect(describeCloser(terminal, 120, withFan).action).toEqual({ kind: "cfm", elementId: 9, value: 120 });
});
