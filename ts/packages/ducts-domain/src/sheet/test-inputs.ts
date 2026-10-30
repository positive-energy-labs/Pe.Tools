/**
 * Test-only: build a resolved `DuctsInputs` from the shorthand the sheet tests used to pass the
 * engine directly (typed end cfm and drops by element id, join and end rulings, a unit's own
 * flow), through the real resolver over a test firm. The engine itself takes only `inputs`.
 */
import type { DuctsFirm, DuctsInputs, DuctUnitKind } from "@pe/agent-contracts";
import { catalogLinkKey } from "../catalog.ts";
import type { SheetSnapshot } from "./build.ts";
import { END_KEY, FITTING_DROP_CELL, JOIN_KEY, resolveInputs, type WorkLayer } from "./inputs.ts";

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
    rules: Object.fromEntries(Object.entries(s.choices ?? {}).map(([k, table]) => [k, { table }])),
    ruleAssignments: Object.fromEntries(
      Object.entries(s.assignments ?? {}).map(([family, rule]) => [family, { rule }]),
    ),
    criteria: {
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
    },
  };
  const flows = work.flows as Record<string, { cfm: number }>;
  const equipmentFlows = work.equipmentFlows as Record<string, { cfm: number }>;
  const terminalDrops = work.terminalDrops as Record<string, { inWg: number }>;
  const componentDrops = work.componentDrops as Record<string, { inWg: number }>;
  const assumptions = work.assumptions as Record<
    string,
    { kind: string; verdict?: string; inWg?: number }
  >;
  for (const [key, inWg] of Object.entries(s.fittingDrops ?? {}))
    assumptions[FITTING_DROP_CELL(key)] = { kind: "component-drop", inWg };
  for (const [id, cfm] of Object.entries(s.endCfm ?? {}))
    (byId.get(Number(id))?.kind === "equipment" ? equipmentFlows : flows)[id] = { cfm };
  for (const [id, inWg] of Object.entries(s.drops ?? {}))
    (byId.get(Number(id))?.kind === "terminal" ? terminalDrops : componentDrops)[id] = { inWg };
  for (const r of s.rulings ?? [])
    assumptions[JOIN_KEY(r.pair)] = {
      kind: "verdict",
      verdict: r.verdict === "accept" ? "connect" : "ignore",
    };
  for (const r of s.endRulings ?? [])
    assumptions[END_KEY(r.end)] = { kind: "verdict", verdict: "capped" };
  for (const [id, role] of Object.entries(s.roles ?? {}))
    (work.roles as Record<string, { role: "fan" | "passive" }>)[id] = { role };
  for (const [id, kind] of Object.entries(s.kinds ?? {})) {
    const n = byId.get(Number(id));
    if (n)
      (work.kinds as Record<string, { kind: DuctUnitKind }>)[catalogLinkKey(n.family, n.type)] = {
        kind,
      };
  }
  const snap = s.slot
    ? { ...snapshot, slots: { ...(snapshot.slots ?? {}), terminalFlow: s.slot } }
    : snapshot;
  return resolveInputs({ snapshot: snap as SheetSnapshot, work, firm: s.firm ?? TEST_FIRM });
}
