import { expect, it } from "vite-plus/test";
import {
  ductsInputsSchema,
  ductsSheetEditsSchema,
  type DuctsInputs,
  type Resolved,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inputFields, protocolPickers, type InputContext } from "./inputs-surface";
import { EMPTY_SNAPSHOT } from "./scoped-snapshot";

const firm = <T>(value: T): Resolved<T> => ({ value, source: "firm", ref: "seed" });
const inputs = (): DuctsInputs =>
  ductsInputsSchema.parse({
    criteria: {
      velocityLimitFpm: { supply: firm(900), return: firm(700) },
      terminalDropInWg: firm(0.03),
      autoJoinGapIn: firm(3),
      healBoxIn: firm(36),
      splitPolicy: firm("even"),
      allowanceInWg: { supply: firm(0), return: firm(0.1) },
    },
    terminals: {},
    units: {},
    components: {},
    tables: {},
    assignments: {},
    fittingDrops: {},
    rulings: { joins: [], ends: [] },
  });
const context = (): InputContext => ({
  snapshot: EMPTY_SNAPSHOT,
  doc: null,
  revision: 3,
  sheet: null,
  inputs: inputs(),
  firm: { version: "seed", path: "Firm/ducts.json", present: false },
  slots: [{ slot: "Airflow", covered: 3, total: 4 }],
  activeSlot: "Airflow",
  element: null,
  fittings: [],
});

it("orders the project criteria and carries source chips from the resolved values", () => {
  const ctx = context();
  ctx.inputs!.criteria.autoJoinGapIn = { value: 4, source: "project" };
  const rows = inputFields(ctx).criteria;
  expect(rows.map((r) => r.key)).toEqual([
    "velocityLimitFpm:supply",
    "velocityLimitFpm:return",
    "terminalDropInWg",
    "autoJoinGapIn",
    "healBoxIn",
    "splitPolicy",
    "allowanceInWg:supply",
    "allowanceInWg:return",
  ]);
  expect(rows[0]).toMatchObject({ value: 900, source: "firm seed", unit: "fpm" });
  expect(rows[3]).toMatchObject({ value: 4, source: "project", unit: "in" });
});

it("edits criteria through the contract, writing and clearing only the edited side of a pair", () => {
  const rows = inputFields(context()).criteria;
  const velocity = rows.find((r) => r.key === "velocityLimitFpm:supply")!;
  const allowance = rows.find((r) => r.key === "allowanceInWg:return")!;
  const split = rows.find((r) => r.kind === "split")!;
  if (velocity.kind !== "number" || allowance.kind !== "number" || split.kind !== "split")
    throw new Error("Missing criterion control");
  expect(ductsSheetEditsSchema.parse(velocity.edit(800))).toEqual({
    criteria: { velocityLimitFpm: { supply: 800 } },
  });
  expect(ductsSheetEditsSchema.parse(allowance.edit(0.2))).toEqual({
    criteria: { allowanceInWg: { return: 0.2 } },
  });
  expect(ductsSheetEditsSchema.parse(velocity.edit(null))).toEqual({
    criteria: { velocityLimitFpm: { supply: null } },
  });
  expect(split.edit("proportional")).toEqual({ criteria: { splitPolicy: "proportional" } });
  for (const row of rows)
    expect(
      ductsSheetEditsSchema.safeParse(
        row.kind === "number" ? row.edit(row.value) : row.edit(row.value),
      ).success,
    ).toBe(true);
});

it("protocol: the fan-flow slot is a picker beside the terminal one, its candidates covered over the walk's units", () => {
  // Chadds (2026-10-29): the C# default PE_M_Fan_AirFlowDesign is empty on every unit; the model's
  // design flows are in PE_M_Fan_AirFlow.
  const unit = (id: number) => ({
    id,
    kind: "equipment",
    connectors: [],
    facts: [],
    flowParameter: null,
  });
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    slots: { fanFlow: "PE_M_Fan_AirFlowDesign", terminalFlow: "Airflow" },
    nodes: [unit(1), unit(2), unit(3)],
    fanFlowCandidates: [
      { slot: "PE_M_Fan_AirFlow", where: "instance", shared: true, have: 3, of: 3, groups: [] },
      { slot: "PE_M_Fan_AirFlowDesign", where: "instance", shared: true, have: 0, of: 3, groups: [] },
    ],
  } as unknown as DuctSnapshot;
  const [terminal, fan] = protocolPickers({ ...context(), snapshot });
  expect(terminal).toMatchObject({ key: "terminalFlow", current: "Airflow" });
  expect(fan).toMatchObject({ key: "fanFlow", current: "PE_M_Fan_AirFlowDesign", noun: "units" });
  expect(fan!.options.map((o) => [o.slot, o.have, o.of])).toEqual([
    ["PE_M_Fan_AirFlow", 3, 3],
    ["PE_M_Fan_AirFlowDesign", 0, 3],
  ]);
});

