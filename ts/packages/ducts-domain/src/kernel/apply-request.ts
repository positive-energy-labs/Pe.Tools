/** Lifted from `pricing.ts` applyRequest (lines ~441-604); network-free: builds the `ducts.apply` request from a flat list of priced legs and one fan port, no group, no Work document. */
import type { DuctsApplyInput } from "@pe/agent-contracts";
import type { DuctSnapshot } from "../types.ts";
import type { Choices, PricedLeg } from "./price-leg.ts";

/** The fan port a sheet is priced from: the unit and the connector index its discharge or inlet is. */
export interface FanPort {
  unitId: number;
  port: number;
}

export interface ApplyRequestInput {
  fan: FanPort;
  /** Required ESP, in-wg; null when the sheet's total is incomplete (never written). */
  requiredEspInWg: number | null;
  /** The fan's design flow, cfm: the sum of its reached terminals; null when unknown. */
  designFlowCfm: number | null;
  /** Every priced leg on the sheet (all paths, both sides). A tap's two legs share an element id; the first wins. */
  legs: readonly PricedLeg[];
  /** Terminal flows the sheet used, with their source. */
  terminalFlows: readonly { id: number; cfm: number; source: string | null }[];
  /** Typed or defaulted drops the sheet used, by element kind. */
  drops: readonly {
    id: number;
    inWg: number;
    source: string | null;
    kind: "terminal" | "component";
  }[];
  /** Rule key -> table the sheet priced under. */
  choices: Choices;
  slots: DuctsApplyInput["slots"];
  /** The model's store as read; the write carries it forward with this apply over it. */
  store: DuctSnapshot["store"];
  appliedAt: string;
}

/** A rule leg's table lookup as the store keeps it: "xLabel=x, yLabel=y, zLabel=z". */
const inputsOf = (inputs: Extract<PricedLeg["source"], { kind: "rule" }>["inputs"]) => {
  const at = (n: number) => +n.toPrecision(4);
  const x = `${inputs.xLabel}=${at(inputs.x)}`;
  const xy = inputs.y == null ? x : `${x}, ${inputs.yLabel ?? "y"}=${at(inputs.y)}`;
  return inputs.z == null ? xy : `${xy}, ${inputs.zLabel ?? "z"}=${at(inputs.z)}`;
};

const byId = <T extends { id: number }>(xs: T[]) => xs.sort((a, b) => a.id - b.id);

/**
 * The native `ducts.apply` request (less `previewOnly`) from one fan sheet: every rule-priced
 * fitting leg under its table (unpriced and inferred (negative id) legs left out), every drop,
 * every terminal flow, the fan's required ESP only when complete, and the store carried forward
 * at the revision read. Rulings and roles in the store pass through untouched.
 */
export function applyRequest(input: ApplyRequestInput): Omit<DuctsApplyInput, "previewOnly"> {
  const seen = new Set<number>();
  const fittings = byId(
    input.legs.flatMap((leg) => {
      if (
        leg.kind !== "fitting" ||
        leg.source?.kind !== "rule" ||
        leg.unpriced ||
        leg.elementId <= 0
      )
        return [];
      if (seen.has(leg.elementId)) return [];
      seen.add(leg.elementId);
      return [
        {
          id: leg.elementId,
          // The Pe server charges the family's own coefficient when it has one, else prices the legs from this table.
          method: "pe-server" as const,
          coefficient: leg.source.coefficient,
          table: leg.source.table,
          inputs: inputsOf(leg.source.inputs),
          ruleKey: leg.source.rule,
        },
      ];
    }),
  );
  const drops = (kind: "terminal" | "component") =>
    byId(
      input.drops
        .filter((d) => d.kind === kind)
        .map(({ id, inWg, source }) => ({ id, inWg, source })),
    );
  const terminals = drops("terminal");
  const components = drops("component");
  const terminalFlows = byId(
    input.terminalFlows.map(({ id, cfm, source }) => ({ id, cfm, source })),
  );
  const equipmentFlows =
    input.designFlowCfm == null
      ? []
      : [
          {
            id: input.fan.unitId,
            cfm: input.designFlowCfm,
            source: "sheet: sum of reached terminals",
          },
        ];
  // Only a complete total is ever written as required ESP (map pillar 3).
  const equipment =
    input.requiredEspInWg == null
      ? []
      : [{ id: input.fan.unitId, externalStaticInWg: input.requiredEspInWg }];
  const stored = input.store;
  const { appliedAt } = input;
  const store: DuctsApplyInput["store"] = {
    ...stored,
    version: 2,
    rules: Object.fromEntries(
      Object.entries(input.choices).map(([key, table]) => [key, { table: table.toUpperCase() }]),
    ),
    instances: {
      ...stored?.instances,
      ...Object.fromEntries(
        fittings.map(({ id, table, inputs, coefficient }) => [
          String(id),
          { table, inputs, coefficient, appliedAt },
        ]),
      ),
    },
    terminals: {
      ...stored?.terminals,
      ...Object.fromEntries(
        terminals.map(({ id, inWg, source }) => [String(id), { inWg, source, appliedAt }]),
      ),
    },
    terminalFlows: {
      ...stored?.terminalFlows,
      ...Object.fromEntries(
        terminalFlows.map(({ id, cfm, source }) => [String(id), { cfm, source, appliedAt }]),
      ),
    },
    equipmentFlows: {
      ...stored?.equipmentFlows,
      ...Object.fromEntries(
        equipmentFlows.map(({ id, cfm, source }) => [String(id), { cfm, source, appliedAt }]),
      ),
    },
    verdicts: stored?.verdicts ?? {},
    roles: stored?.roles ?? {},
    slots: Object.fromEntries(
      Object.entries({ ...stored?.slots, ...input.slots }).flatMap(([key, name]) =>
        name ? [[key, name]] : [],
      ),
    ),
    workRevision: stored?.workRevision ?? 0,
    appliedAt,
  };
  return {
    slots: input.slots,
    fittings,
    terminals,
    components,
    equipment,
    terminalFlows,
    equipmentFlows,
    store,
  };
}
