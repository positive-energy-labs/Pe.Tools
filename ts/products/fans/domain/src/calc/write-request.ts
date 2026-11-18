import type { DuctsApplyInput } from "@pe/agent-contracts";
import type { BuildCalcInput } from "./build.ts";
import { isCompleteClaim, type CompleteClaim, type DomainClaim } from "./encounters.ts";
import type { Calc } from "./types.ts";
import { accessoryWrites } from "./accessory-writes.ts";

const MINTED = Symbol("fan write request");
/** The wire payload; only this mint supplies its hidden symbol capability, omitted by JSON. */
export type FanWriteRequest = DuctsApplyInput & { readonly [MINTED]: true };
export interface FanWriteContext {
  /** Stamped at plan and reused at apply, so unchanged inputs seal identically. */
  appliedAt: string;
  /** Resolved names: requiredEsp null means none, encoded as "" in native overrides (R3). */
  slots: DuctsApplyInput["slots"];
  /** P-060: caller builds this map from the other cohort units' current sheets, keyed by unit id.
   * Type-owned ESP requires every peer complete and equal to `claim` at six decimal in-wg (the
   * complete claim's written precision). Missing/incomplete/unequal peers refuse the whole write.
   * The active unit uses the claim argument; instance-owned ESP needs no peer entry. */
  peerClaims: ReadonlyMap<number, DomainClaim>;
  rulings: Pick<NonNullable<DuctsApplyInput["store"]>, "roles">;
  storeDeletes: Pick<NonNullable<DuctsApplyInput["storeDeletes"]>, "roles">;
}

/** Date.parse alone loses 100-ns freshness: normalize the zone at whole seconds, then retain all seven fractional digits. */
const instantTicks = (value: string): bigint | null => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * 10_000n + BigInt((match[2] ?? "").padEnd(7, "0"))
    : null;
};
const sameInstant = (a: string, b: string): boolean => {
  const ticks = instantTicks(a);
  return ticks !== null && ticks === instantTicks(b);
};

/** No derived flow and no row outside the fan's walk, except its native ESP cohort. */
export function mintWriteRequest(
  claim: CompleteClaim,
  sheet: Calc,
  input: BuildCalcInput,
  context: FanWriteContext,
): { request: FanWriteRequest; fittingRules: ReadonlyMap<number, string> } {
  if (sheet.claim !== claim || claim.kind !== "complete" || !isCompleteClaim(claim))
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
  const fittingRules = new Map<number, string>();
  const fittings: DuctsApplyInput["fittings"] = fittingIds.flatMap((id) => {
    const evidence = legs
      .filter((l) => l.elementId === id)
      .flatMap((l) => (l.evidence.kind === "coefficient" ? [l.evidence] : []));
    const first = evidence[0];
    if (!first) return [];
    fittingRules.set(id, first.rule);
    return [
      {
        id,
        method: "pe-server",
        coefficient: first.coefficient,
        table: first.table,
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
  let equipment: DuctsApplyInput["equipment"] = [];
  if (required !== "") {
    const cohort = snapshot.parameterCohorts?.find(
      (c) => c.parameter === required && c.members.some((m) => m.elementId === sheet.fan.unitId),
    );
    if (
      !cohort ||
      !cohort.complete ||
      !sameInstant(cohort.basis, snapshot.document.readAt) ||
      !cohort.members.length ||
      (cohort.owner.kind === "instance" && cohort.members.length !== 1)
    )
      throw Error("The required ESP parameter cohort is missing, incomplete or stale; read again");
    if (cohort.owner.kind === "type") {
      const peers = cohort.members.map((m) => ({
        id: m.elementId,
        claim: m.elementId === sheet.fan.unitId ? claim : context.peerClaims.get(m.elementId),
      }));
      if (
        peers.some(
          (p) =>
            p.claim?.kind !== "complete" ||
            !isCompleteClaim(p.claim) ||
            p.claim.requiredEspInWg.toFixed(6) !== claim.requiredEspInWg.toFixed(6),
        )
      )
        throw Error(
          `Required ESP type cohort cannot share one claimed value: ${peers
            .map(
              (p) =>
                `${p.id}: ${
                  p.claim?.kind === "complete"
                    ? `${p.claim.requiredEspInWg} in-wg${isCompleteClaim(p.claim) ? "" : " (unbranded)"}`
                    : p.claim
                      ? `${p.claim.kind} (known ${p.claim.knownInWg} in-wg)`
                      : "missing"
                }`,
            )
            .join("; ")}. Use an instance ESP parameter or change the design`,
        );
    }
    equipment = unique(
      cohort.members.map((m) => ({
        id: m.elementId,
        externalStaticInWg: claim.requiredEspInWg,
      })),
    );
  }
  const request: FanWriteRequest = {
    [MINTED]: true,
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
  };
  return { request: Object.defineProperty(request, MINTED, { enumerable: false }), fittingRules };
}
