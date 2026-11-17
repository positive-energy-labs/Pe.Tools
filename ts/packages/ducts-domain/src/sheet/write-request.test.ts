import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { ductsApplyInputSchema, type FanClaim } from "@pe/agent-contracts";
import {
  connOf,
  ductOf,
  factOf,
  groupOf,
  nodeOf,
  round,
  slots,
  snapshotOf,
} from "../test-snapshot.ts";
import { suggestRoster } from "../roster.ts";
import { toGrids } from "../loss-grid.ts";
import { elementSubject } from "../work-subject.ts";
import { buildSheet, type BuildSheetInput, type SheetSnapshot } from "./build.ts";
import {
  TEST_FIRM,
  TEST_WALK,
  cell,
  inputsFor,
  withFamilyFlipped,
  withPeersRead,
} from "./test-inputs.ts";
import { resolveInputs, type WorkLayer } from "./inputs.ts";
import { mintWriteRequest, type FanWriteContext } from "./write-request.ts";
import { accessoryWrites } from "./accessory-writes.ts";
import { applyRequest, price } from "../pricing.ts";
import { designOf } from "../test-design.ts";
const at = "2026-11-16T00:00:00Z";
const grids = toGrids(
  JSON.parse(
    readFileSync(
      new URL(
        "../../../../apps/host/tests/native-recordings/driver-ducts.tables.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
function synthetic() {
  const port = (index: number, to: [number, number], classification: string) =>
    connOf(index, to, { ...round(12), classification });
  const terminal = (id: number, to: [number, number], classification: string) =>
    nodeOf(id, "terminal", {
      groupId: classification === "ReturnAir" ? "r" : "g",
      family: "terminal",
      flowParameter: "revit:Flow",
      connectors: [{ ...port(0, to, classification), flowCfm: 200 }],
      facts: [factOf("flow", 200)],
    });
  return snapshotOf({
    walk: TEST_WALK,
    document: {
      title: "closed synthetic",
      readAt: at,
      elapsedMs: 0,
      networkBasedCalculations: false,
    },
    slots: { ...slots, terminalFlow: "revit:Flow", requiredEsp: "ESP" },
    groups: [
      groupOf("g", { rootIds: [100], terminalCount: 1, elementCount: 3 }),
      groupOf("r", { rootIds: [100], terminalCount: 1, elementCount: 2 }),
    ],
    nodes: [
      nodeOf(100, "equipment", {
        family: "Air Handler",
        flowParameter: "Fan Flow",
        connectors: [
          { ...port(0, [1, 0], "SupplyAir"), direction: "out" },
          { ...port(1, [4, 0], "ReturnAir"), direction: "in" },
        ],
      }),
      nodeOf(2, "fitting", {
        groupId: "g",
        partType: "Elbow",
        family: "Round Elbow",
        connectors: [port(0, [1, 1], "SupplyAir"), port(1, [3, 0], "SupplyAir")],
        facts: [factOf("rOverD", 1)],
      }),
      terminal(3, [2, 1], "SupplyAir"),
      terminal(5, [4, 1], "ReturnAir"),
    ],
    segments: [
      ductOf(1, {
        ...round(12),
        groupId: "g",
        lengthFt: 10,
        polyline: [
          [0, 0, 0],
          [10, 0, 0],
        ],
        connectors: [port(0, [100, 0], "SupplyAir"), port(1, [2, 0], "SupplyAir")],
      }),
      ductOf(4, {
        ...round(12),
        groupId: "r",
        lengthFt: 10,
        polyline: [
          [0, 0, 0],
          [-10, 0, 0],
        ],
        connectors: [port(0, [100, 1], "ReturnAir"), port(1, [5, 0], "ReturnAir")],
      }),
    ],
  });
}

function component() {
  const snapshot = synthetic();
  snapshot.nodes.find((n) => n.id === 2)!.connectors[1]!.connectedTo = {
    elementId: 6,
    connector: 0,
  };
  snapshot.nodes.find((n) => n.id === 3)!.connectors[0]!.connectedTo = {
    elementId: 6,
    connector: 1,
  };
  snapshot.nodes.push(
    nodeOf(6, "accessory", {
      family: "Inline damper",
      groupId: "g",
      connectors: [connOf(0, [2, 1], round(12)), connOf(1, [3, 0], round(12))],
      facts: [factOf("pressureDrop", 0.12)],
    }),
  );
  return snapshot;
}

function prepared(snapshot = synthetic(), work: WorkLayer = {}, run: WorkLayer = {}) {
  const r = suggestRoster(snapshot);
  const input: BuildSheetInput = {
    snapshot,
    fan: { unitId: 100, portIndex: 0 },
    grids,
    inputs: resolveInputs({ snapshot, work, run, firm: TEST_FIRM }),
    roster: [...r.fans, ...r.suggestions],
  };
  const sheet = buildSheet(input);
  const context: FanWriteContext = {
    appliedAt: at,
    slots: snapshot.slots,
    cells: [],
    rulings: {},
    storeDeletes: { roles: [], verdicts: [] },
  };
  function mint(c = context) {
    if (sheet.claim.kind !== "complete") throw Error(JSON.stringify(sheet.claim));
    return mintWriteRequest(sheet.claim, sheet, input, c);
  }
  return { sheet, input, context, mint };
}

it("requires this sheet's branded complete claim, never a wire FanClaim", () => {
  const p = prepared(),
    other = prepared();
  if (other.sheet.claim.kind !== "complete") throw Error("fixture must be complete");
  const claim = other.sheet.claim;
  expect(() => mintWriteRequest(claim, p.sheet, p.input, p.context)).toThrow("complete claim");
  const wire: FanClaim = JSON.parse(JSON.stringify(other.sheet.claim));
  // @ts-expect-error The wire claim has no complete capability.
  expect(() => mintWriteRequest(wire, p.sheet, p.input, p.context)).toThrow("complete claim");
});

it("refuses a truncated walk before it can mint any native preview", () => {
  const p = prepared();
  p.input.snapshot.walk = { ...TEST_WALK, truncated: true };
  const sheet = buildSheet(p.input);
  expect(sheet.claim.kind).toBe("incomplete");
  if (sheet.claim.kind !== "incomplete") throw Error("incomplete walk");
  const claim = sheet.claim;
  // @ts-expect-error An incomplete claim never satisfies the write capability.
  expect(() => mintWriteRequest(claim, sheet, p.input, p.context)).toThrow("complete claim");
});
it("writes the claim's required ESP to only the fan and its complete fresh native cohort", () => {
  const snapshot = synthetic();
  snapshot.parameterCohorts = [
    {
      parameter: "ESP",
      owner: { kind: "type", id: 77 },
      members: [100, 999].map((id) => ({ elementId: id, uniqueId: `u${id}` })),
      complete: true,
      basis: at,
    },
  ];
  const p = prepared(snapshot);
  if (p.sheet.claim.kind !== "complete") throw Error("complete");
  expect(p.mint().equipment).toEqual(
    [100, 999].map((id) => ({
      id,
      externalStaticInWg: p.sheet.claim.kind === "complete" ? p.sheet.claim.requiredEspInWg : -1,
    })),
  );
  snapshot.parameterCohorts[0]!.complete = false;
  expect(() => p.mint()).toThrow("incomplete or stale");
  snapshot.parameterCohorts[0]!.complete = true;
  snapshot.parameterCohorts[0]!.basis = "old";
  expect(() => p.mint()).toThrow("incomplete or stale");
});
it("a firm with no required ESP slot emits no equipment row, including over native peers", () => {
  const p = prepared();
  expect(
    p.mint({ ...p.context, slots: { ...p.context.slots, requiredEsp: null } }).equipment,
  ).toEqual([]);
  expect(
    p.mint({ ...p.context, slots: { ...p.context.slots, requiredEsp: "" } }).equipment,
  ).toEqual([]);
});
it("never derives terminal or equipment flow; only Work or run can write", () => {
  expect(prepared().mint().terminalFlows).toEqual([]);
  expect(prepared().mint().equipmentFlows).toEqual([]);
  const snapshot = synthetic();
  const fan = snapshot.nodes.find((n) => n.id === 100)!;
  const terminal = snapshot.nodes.find((n) => n.id === 3)!;
  const p = prepared(
    snapshot,
    { flows: { [elementSubject(terminal)]: cell(200) } },
    { equipmentFlows: { [elementSubject(fan)]: cell(200) } },
  );
  const request = p.mint({ ...p.context, slots: { ...p.context.slots, fanFlow: "Fan Flow" } });
  expect(request.terminalFlows.map((f) => f.id)).toEqual([3]);
  expect(request.equipmentFlows.map((f) => f.id)).toEqual([100]);
  expect(request.terminalFlows[0]!.source).toContain("Work");
  expect(request.equipmentFlows[0]!.source).toContain("run");
});
it("includes the domain accessory writes and clips every noncohort row to the sheet walk", () => {
  const p = prepared(component()),
    request = p.mint();
  expect(request.components).toEqual(
    expect.arrayContaining(accessoryWrites(p.input.snapshot, p.sheet)),
  );
  expect(request.components.some((c) => c.id === 6)).toBe(true);
  for (const rows of [
    request.fittings,
    request.components,
    request.terminals,
    request.terminalFlows,
    request.equipmentFlows,
  ])
    expect(rows.every((r) => p.sheet.walkedElementIds.includes(r.id) || r.id === 100)).toBe(true);
});
it("refuses an authored flow slot different from the observed slot", () => {
  const snapshot = synthetic(),
    terminal = snapshot.nodes.find((n) => n.id === 3)!;
  const p = prepared(snapshot, { flows: { [elementSubject(terminal)]: cell(200) } });
  expect(() =>
    p.mint({ ...p.context, slots: { ...p.context.slots, terminalFlow: "Wrong" } }),
  ).toThrow("no observed airflow parameter");
});
it("is pure with an explicit plan timestamp and preserves native slot none on the wire", () => {
  const p = prepared();
  expect(p.mint()).toEqual(p.mint());
  expect(ductsApplyInputSchema.safeParse(p.mint()).success).toBe(true);
  const none = p.mint({ ...p.context, slots: { requiredEsp: null } });
  expect(ductsApplyInputSchema.parse(none).slots?.requiredEsp).toBe("");
  expect(
    ductsApplyInputSchema.safeParse({ ...none, slots: { requiredEsp: "ESP", ratedEsp: "esp" } })
      .success,
  ).toBe(false);
});
// L2-3 accepted differences: port versus group scope, computed ESP versus staged ESP,
// tap representative, free-text provenance, all priced fittings/drops versus staged-only writes,
// and authored-only flows versus the old group's derived terminal flows.
it("compares the group and mint on the recorded Manual D fan before the engine is removed", () => {
  const recorded = JSON.parse(
    readFileSync(new URL("./fixtures/manual-d-20261102.json", import.meta.url), "utf8"),
  );
  const snapshot = withPeersRead(withFamilyFlipped(recorded as SheetSnapshot, 14577391));
  const tableData = JSON.parse(
    readFileSync(new URL("./fixtures/manual-d-tables.json", import.meta.url), "utf8"),
  );
  const fixtureGrids = toGrids({ tables: tableData });
  const r = suggestRoster(recorded);
  // Replay repairs match manual-d.test.ts: family direction, coverage, stated flow/drops and intake join.
  // Additionally accept this replay's encounters, so its complete claim can exercise the mint.
  const input: BuildSheetInput = {
    snapshot,
    fan: { unitId: 14577391, portIndex: 2 },
    grids: fixtureGrids,
    roster: [...r.fans, ...r.suggestions],
    inputs: inputsFor(snapshot, {
      endCfm: { 14577391: 900 },
      drops: { 14577394: 0.0132, 14577396: 0.18, 14088043: 0.026 },
      rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
    }),
  };
  const first = buildSheet(input);
  input.encounterRulings = first.encounters.map((e) => ({
    at: { elementId: e.elementId, connector: e.connector },
    verdict: "accepted",
    by: "human",
    ref: "replay:accepted-tie-in",
  }));
  const sheet = buildSheet(input);
  expect(sheet.claim.kind, JSON.stringify(sheet.claim)).toBe("complete");
  if (sheet.claim.kind !== "complete") throw Error("complete replay");
  const context: FanWriteContext = {
    appliedAt: at,
    slots: {
      ...snapshot.slots,
      fanFlow: snapshot.nodes.find((n) => n.id === 14577391)!.flowParameter,
    },
    cells: [],
    rulings: {},
    storeDeletes: {},
  };
  const minted = mintWriteRequest(sheet.claim, sheet, input, context);
  const group = applyRequest(
    recorded,
    price(recorded, fixtureGrids, designOf(), designOf()),
    at,
    [],
  );
  expect(group.equipment).toEqual([]);
  expect(minted.equipment).toEqual([
    { id: 14577391, externalStaticInWg: sheet.claim.requiredEspInWg },
  ]);
  expect(minted.components).toEqual(expect.arrayContaining(accessoryWrites(snapshot, sheet)));
  expect(minted.fittings.length).toBeGreaterThan(group.fittings.length);
  expect(minted.terminalFlows).toEqual([]);
});
