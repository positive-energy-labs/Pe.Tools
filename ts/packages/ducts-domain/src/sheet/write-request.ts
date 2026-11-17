import type { DuctsApplyInput } from "@pe/agent-contracts";
import type { BuildSheetInput } from "./build.ts";
import type { CompleteClaim } from "./encounters.ts";
import type { Sheet } from "./types.ts";
import { accessoryWrites } from "./accessory-writes.ts";

declare const MINTED: unique symbol;
/** The wire payload, with a phantom capability that only this mint supplies. */
export type FanWriteRequest = DuctsApplyInput & { readonly [MINTED]: true };
export interface FanWriteContext {
  /** Stamped at plan and reused at apply, so unchanged inputs seal identically. */
  appliedAt: string;
  /** Resolved names: requiredEsp null means none, encoded as "" in native overrides (R3). */
  slots: DuctsApplyInput["slots"];
  cells: readonly (readonly [segment: string, key: string])[];
  rulings: Pick<NonNullable<DuctsApplyInput["store"]>, "verdicts" | "roles">;
  storeDeletes: NonNullable<DuctsApplyInput["storeDeletes"]>;
}

/** No derived flow and no row outside the fan's walk, except its native ESP cohort. */
export function mintWriteRequest(
  claim: CompleteClaim,
  sheet: Sheet,
  input: BuildSheetInput,
  context: FanWriteContext,
): FanWriteRequest {
  if (sheet.claim !== claim || claim.kind !== "complete")
    throw Error("The sheet's complete claim is required");
  const { snapshot, inputs } = input;
  const { appliedAt } = context;
  const slots = { ...context.slots };
  if (slots.requiredEsp === null) slots.requiredEsp = "";
  const here = new Set(sheet.walkedElementIds);
  here.add(sheet.fan.unitId);
  const nodes = new Map(snapshot.nodes.filter((n) => here.has(n.id)).map((n) => [n.id, n]));
  const legs = Object.values(sheet.legs).filter((l) => here.has(l.elementId) && l.elementId > 0);
  const fittingIds = [
    ...new Set(
      legs
        .filter((l) => l.kind === "fitting" && l.evidence.kind === "coefficient")
        .map((l) => l.elementId),
    ),
  ];
  const fittings: DuctsApplyInput["fittings"] = fittingIds.flatMap((id) => {
    const evidence = legs
      .filter((l) => l.elementId === id)
      .flatMap((l) => (l.evidence.kind === "coefficient" ? [l.evidence] : []));
    const first = evidence[0];
    if (!first) return [];
    return [
      {
        id,
        method: "pe-server",
        coefficient: first.coefficient,
        table: first.table,
        ruleKey: first.rule,
        inputs: Object.entries(first.lookup)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
        results: evidence
          .map((e) => ({
            velocityPressureInWg: e.velocityPressureInWg,
            coefficient: e.coefficient,
          }))
          .filter(
            (e, i, all) =>
              all.findIndex(
                (x) =>
                  x.velocityPressureInWg === e.velocityPressureInWg &&
                  x.coefficient === e.coefficient,
              ) === i,
          ),
      },
    ];
  });
  const drops = (kind: "terminal" | "accessory" | "equipment") =>
    legs.flatMap((l) =>
      l.kind === kind && l.evidence.kind === "drop" && l.lossInWg != null
        ? [{ id: l.elementId, inWg: l.lossInWg, source: l.evidence.value.ref }]
        : [],
    );
  const unique = <T extends { id: number }>(rows: T[]) =>
    [...new Map(rows.map((r) => [r.id, r])).values()].sort((a, b) => a.id - b.id);
  const terminals = unique(drops("terminal"));
  const components = unique([
    ...accessoryWrites(snapshot, sheet).filter((r) => here.has(r.id)),
    ...drops("accessory"),
    ...drops("equipment"),
  ]);
  const flows = (kind: "terminal" | "equipment") =>
    [...nodes.values()]
      .filter((n) => n.kind === kind)
      .flatMap((n) => {
        const value =
          kind === "terminal"
            ? inputs.terminals[String(n.id)]?.cfm
            : inputs.units[String(n.id)]?.cfm;
        if (value?.status !== "valid" || !["Work", "run"].includes(value.source)) return [];
        const authored = (kind === "terminal" ? slots.terminalFlow : slots.fanFlow) ?? undefined;
        const observed = n.flowParameter;
        const slot = authored ?? observed;
        // The authored slot must be the one observed on this element, never a fallback to a different parameter.
        if (!observed || slot !== observed)
          throw Error(
            `Element ${n.id} has no observed airflow parameter '${slot ?? ""}'; refresh its flow slot before preview`,
          );
        return [
          {
            id: n.id,
            cfm: value.value,
            source: [value.source, value.ref].filter(Boolean).join(":"),
            slot,
          },
        ];
      });
  const terminalFlows = unique(flows("terminal")),
    equipmentFlows = unique(flows("equipment"));
  const required = slots.requiredEsp;
  const cohort = snapshot.parameterCohorts?.find(
    (c) => c.parameter === required && c.members.some((m) => m.elementId === sheet.fan.unitId),
  );
  if (
    required !== "" &&
    cohort &&
    (!cohort.complete ||
      cohort.basis !== snapshot.document.readAt ||
      !cohort.members.length ||
      (cohort.owner.kind === "instance" && cohort.members.length !== 1))
  )
    throw Error("The required ESP parameter cohort is incomplete or stale; read again");
  const equipment =
    required === ""
      ? []
      : unique(
          (cohort?.members.map((m) => m.elementId) ?? [sheet.fan.unitId]).map((id) => ({
            id,
            externalStaticInWg: claim.requiredEspInWg,
          })),
        );
  return {
    slots,
    fittings,
    terminals,
    components,
    equipment,
    terminalFlows,
    equipmentFlows,
    store: {
      version: 2,
      workRevision: 0,
      ...snapshot.store,
      appliedAt,
      slots,
      rules: Object.fromEntries(fittings.map((f) => [f.ruleKey!, { table: f.table }])),
      instances: Object.fromEntries(
        fittings.map((f) => [
          String(f.id),
          { table: f.table, inputs: f.inputs, coefficient: f.coefficient, appliedAt },
        ]),
      ),
      terminals: Object.fromEntries(
        terminals.map((t) => [String(t.id), { inWg: t.inWg, source: t.source, appliedAt }]),
      ),
      terminalFlows: Object.fromEntries(
        terminalFlows.map((f) => [String(f.id), { cfm: f.cfm, source: f.source, appliedAt }]),
      ),
      equipmentFlows: Object.fromEntries(
        equipmentFlows.map((f) => [String(f.id), { cfm: f.cfm, source: f.source, appliedAt }]),
      ),
      ...context.rulings,
    },
    storeDeletes: context.storeDeletes,
  } as FanWriteRequest;
}
