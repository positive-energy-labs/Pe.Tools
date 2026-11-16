/** Test-only: build a resolved `DuctsInputs` from the shorthand the sheet tests used to pass the engine directly (typed end cfm and drops by element id, join and end rulings, a unit's own flow), through the real resolver over a test firm. */
import { elementSubject } from "../work-subject.ts";
import { DUCTS_CRITERIA_CELLS, type DuctsCriteriaCell, type DuctsFirm, type DuctsInputs, type DuctUnitKind } from "@pe/agent-contracts";
import { catalogLinkKey } from "../catalog.ts";
import type { DuctSnapshot } from "../types.ts";
import type { SheetSnapshot } from "./build.ts";
import { END_KEY, FITTING_DROP_CELL, JOIN_KEY, resolveInputs, type WorkCell, type WorkLayer } from "./inputs.ts";

/** Test-only: a staged cell as a person staged it (contract amendment 2). */
export const cell = <T>(value: T, by: WorkCell<T>["by"] = "human", ref = "work:test"): WorkCell<T> => ({
  value,
  by,
  ref,
});
/** Test-only: a person staged every criterion the layer states. */
export const stamped = (criteria: NonNullable<WorkLayer["criteria"]>): Pick<WorkLayer, "criteria" | "criteriaMeta"> => ({
  criteria,
  criteriaMeta: Object.fromEntries(
    Object.entries(DUCTS_CRITERIA_CELLS).flatMap(([name, { layer: [key, side] }]) => {
      const at = (criteria as Record<string, unknown>)[key];
      const value = side ? (at as Record<string, unknown> | undefined)?.[side] : at;
      return value === undefined ? [] : [[name as DuctsCriteriaCell, { by: "human", ref: "work:test" }] as const];
    }),
  ),
});

export const TEST_SLOTS: DuctSnapshot["slots"] = {
  fanStatic: "",
  fanFlow: "",
  componentDrop: "",
  terminalDrop: "PE_M_Grd_ExternalStaticPressure",
  fittingCoefficient: "",
  terminalFlow: "",
};

export const TEST_FIRM: DuctsFirm = {
  version: "test",
  criteria: {
    velocityLimitFpm: { supply: 900, return: 700 },
    terminalDropInWg: 0.03,
    autoJoinGapIn: 3,
    healBoxIn: 36,
    splitPolicy: "even",
    allowanceInWg: { supply: 0, return: 0 },
  },
};

export interface InputsShorthand {
  /** Typed flow at an end by element id: a terminal's design cfm, or a unit's own flow. */
  endCfm?: Readonly<Record<number, number>>;
  /** Typed drops by element id: a terminal's, or any other part's. */
  drops?: Readonly<Record<number, number>>;
  /** Typed per-path drops on proposed fittings, by `PROPOSED_KEY`. */
  fittingDrops?: Readonly<Record<string, number>>;
  /** Fitting family to the rule key it is priced as where no rule matches. */
  assignments?: Readonly<Record<string, string>>;
  rulings?: readonly { pair: readonly [string, string]; verdict: "accept" | "reject" }[];
  endRulings?: readonly { end: { elementId: number; connector: number }; verdict: "capped" }[];
  /** The confirmed airflow slot; overrides the snapshot's. */
  slot?: string;
  splitPolicy?: "even" | "proportional";
  terminalDropInWg?: number;
  allowanceInWg?: { supply?: number; return?: number };
  kinds?: Readonly<Record<number, DuctUnitKind>>;
  roles?: Readonly<Record<number, "fan" | "passive">>;
  /** Loss-rule key to table. */
  choices?: Readonly<Record<string, string>>;
  firm?: DuctsFirm;
}

export function inputsFor(snapshot: SheetSnapshot, s: InputsShorthand = {}): DuctsInputs {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const work: WorkLayer = {
    flows: {},
    equipmentFlows: {},
    terminalDrops: {},
    componentDrops: {},
    roles: {},
    kinds: {},
    assumptions: {},
    rules: Object.fromEntries(Object.entries(s.choices ?? {}).map(([k, table]) => [k, cell(table)])),
    ruleAssignments: Object.fromEntries(
      Object.entries(s.assignments ?? {}).map(([family, rule]) => [family, cell(rule)]),
    ),
    ...stamped({
      ...(s.splitPolicy ? { splitPolicy: s.splitPolicy } : {}),
      ...(s.terminalDropInWg != null ? { terminalDropInWg: s.terminalDropInWg } : {}),
      ...(s.allowanceInWg
        ? {
            allowanceInWg: {
              supply: s.allowanceInWg.supply ?? 0,
              return: s.allowanceInWg.return ?? 0,
            },
          }
        : {}),
    }),
  };
  type Cells<K extends Exclude<keyof WorkLayer, "criteria" | "criteriaMeta">> = Record<string, NonNullable<WorkLayer[K]>[string]>;
  const flows = work.flows as Cells<"flows">;
  const equipmentFlows = work.equipmentFlows as Cells<"equipmentFlows">;
  const terminalDrops = work.terminalDrops as Cells<"terminalDrops">;
  const componentDrops = work.componentDrops as Cells<"componentDrops">;
  const assumptions = work.assumptions as Cells<"assumptions">;
  for (const [key, inWg] of Object.entries(s.fittingDrops ?? {}))
    assumptions[FITTING_DROP_CELL(key)] = cell({ kind: "component-drop", inWg });
  for (const [id, cfm] of Object.entries(s.endCfm ?? {}))
    (byId.get(Number(id))?.kind === "equipment" ? equipmentFlows : flows)[elementSubject(byId.get(Number(id))!)] = cell(cfm);
  for (const [id, inWg] of Object.entries(s.drops ?? {}))
    (byId.get(Number(id))?.kind === "terminal" ? terminalDrops : componentDrops)[elementSubject([...snapshot.nodes, ...snapshot.segments].find(e => e.id === Number(id))!)] = cell(inWg);
  for (const r of s.rulings ?? [])
    assumptions[JOIN_KEY(r.pair)] = cell({
      kind: "verdict",
      verdict: r.verdict === "accept" ? "connect" : "ignore",
    });
  for (const r of s.endRulings ?? [])
    assumptions[END_KEY(r.end)] = cell({ kind: "verdict", verdict: "capped" });
  for (const [id, role] of Object.entries(s.roles ?? {}))
    (work.roles as Cells<"roles">)[elementSubject(byId.get(Number(id))!)] = cell(role);
  for (const [id, kind] of Object.entries(s.kinds ?? {})) {
    const n = byId.get(Number(id));
    if (n)
      (work.kinds as Cells<"kinds">)[catalogLinkKey(n.family, n.type)] = cell<DuctUnitKind>(kind);
  }
  const snap = s.slot
    ? { ...snapshot, slots: { ...(snapshot.slots ?? {}), terminalFlow: s.slot } }
    : snapshot;
  return resolveInputs({ snapshot: snap as SheetSnapshot, work, firm: s.firm ?? TEST_FIRM });
}

/**
 * Test-only: the same capture with one unit's connector directions swapped, the family as the network
 * reads it. Q4 makes the family's direction the authority, so a capture whose family reads backwards
 * prices the wrong way round; tests that prove pricing on that capture's real geometry state the roles here.
 */
export const withFamilyFlipped = <S extends SheetSnapshot>(snapshot: S, unitId: number): S => ({
  ...snapshot,
  nodes: snapshot.nodes.map((n) =>
    n.id !== unitId
      ? n
      : {
          ...n,
          connectors: n.connectors.map((c) => ({
            ...c,
            direction: c.direction === "in" ? "out" : c.direction === "out" ? "in" : c.direction,
          })),
        },
  ),
});
