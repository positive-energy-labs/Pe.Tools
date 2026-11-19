import { catalogsFor } from "@pe/ducts-host/ducts-files";
import { workElementId } from "@pe/ducts-domain/work-subject";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import { ductsPricingData } from "@pe/duct-systems-contract/ducts-read";
import { type DuctsApplyInput } from "@pe/duct-systems-contract/ducts";
import { type FanClaim } from "@pe/fans-contract/fans-inputs";


import { TABLE_IDS } from "@pe/ducts-domain/table-ids";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { stagedValues } from "@pe/duct-systems-contract/ducts";





import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { RevitBridge } from "@pe/host/bridge";
import { refused } from "@pe/host/command-executor";



import { runPods } from "@pe/host/family-actions";
import { buildCalc, encounterRulings, mintWriteRequest, resolveInputs, type BuildCalcInput, type DomainClaim, type FanWriteContext, type CalcSnapshot } from "@pe/fans-domain/calc/index";
import { followAcceptedJoins } from "@pe/ducts-domain/calc/joins";
import { pendingRulings, storeRulings, withStoredRulings } from "@pe/ducts-domain/rulings";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { workLayer } from "@pe/ducts-host/ducts-inputs";


import { scopeApplyRequest, appliedCellPaths, fanWriteCells } from "@pe/ducts-domain/staged";
import type { DuctsApply } from "@pe/host-contracts/generated";

import { ductActionExecutors, type DuctActionPreparation, type DuctActionDependencies } from "@pe/ducts-host/action-runtime";
/** Refused intent cannot authorize ancillary writes, even when those writes planned successfully. */
export const lossPlanRefusal = (writes: DuctsApply.Res.Response["writes"]) =>
  writes.some((w) => w.outcome === "refused")
    ? [...new Set(writes.filter((w) => w.outcome === "refused").map((w) => w.reason))].join("; ")
    : null;

/** A fan preview acquires both sides, as its worksheet does. A truncated walk never previews a write. */
export async function lossSnapshot(
  intent: { walk?: { unitId: number; portIndex: number } } | undefined,
  read: (selector: Record<string, unknown>) => Promise<DuctSnapshot>,
): Promise<DuctSnapshot> {
  if (!intent?.walk)
    throw refused("Preview needs writeIntent.walk from the fan roster; stage a scope before previewing losses");
  const snapshot = await read({ kind: "from", unitId: intent.walk.unitId });
  if (snapshot.walk?.truncated)
    throw refused("The fan walk is truncated; no writes can be previewed from this scope");
  return snapshot;
}

/** Why a claim writes nothing, in its own evidence (its boundaries, or its coverage gaps and blockers); null when complete. */
export function claimRefusal(claim: FanClaim): string | null {
  if (claim.kind === "complete") return null;
  const held = claim.kind === "to-boundary"
    ? claim.boundaries.map((b) => `${b.verdict} tie-in at element ${b.elementId} connector ${b.connector} into unit ${b.host.unitId}`)
    : [...claim.coverage.map((gap) => `${gap.kind}${gap.elementId == null ? "" : ` at element ${gap.elementId}`} (${gap.ref})`), ...claim.blockingIds];
  return `Nothing is written from a ${claim.kind} fan calc (known ${claim.knownInWg} in-wg): ${held.join("; ") || "no reason was given"}`;
}

/**
 * The fans write (L2-3, invariant 1): the sheet is built here and the request is minted from its
 * complete claim, the only place a write request is built. Any other claim is refused with its kind
 * and what holds it open.
 */
export function fanWriteRequest(input: BuildCalcInput, context: FanWriteContext) {
  const sheet = buildCalc(input), claim = sheet.claim;
  if (claim.kind !== "complete") throw refused(claimRefusal(claim) ?? "", "ducts.claim-incomplete");
  try {
    ductsPricingData.shape.calcs.element.parse(sheet);
    // P-061, P-067: a complete claim carries a runtime symbol that only buildSheet sets and the mint checks, so a decoded sheet
    // or claim cannot pass. Mint only from the buildSheet above, in this process.
    return { claim, legs: sheet.legs, ...mintWriteRequest(claim, sheet, input, context) };
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error), "ducts.mint-refused");
  }
}

export function unwrittenCells(
  request: Pick<DuctsApplyInput, "terminals" | "components" | "equipment" | "terminalFlows" | "equipmentFlows">,
  cells: readonly (readonly [string, string])[],
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
): (readonly [string, string])[] {
  const written: Record<string, readonly { id: number }[]> = {
    terminalDrops: request.terminals,
    componentDrops: request.components,
    flows: request.terminalFlows,
    equipmentFlows: request.equipmentFlows,
  };
  return cells.filter(([segment, key]) => written[segment] && !written[segment]!.some((row) => row.id === workElementId(snapshot, key)),
  );
}

/**
 * Why one requested cell derived no write. A cell whose Work edit is empty (published, restored or
 * never staged) is not a staged value: the scope naming it is no authority to write it.
 */
export function unwrittenReason(staged: ReturnType<typeof stagedValues>, [segment, key]: readonly [string, string],
) {
  const cells = staged[segment as keyof typeof staged] as Record<string, unknown> | undefined;
  return cells && key in cells
    ? "staged, but this scope derives no write for it"
    : "no staged edit: its Work cell is empty (published, restored or never staged); stage it again to write it";
}

/**
 * What a fans apply sends of the store's rulings: its own roles only (D9, field map invariant 8). A
 * /duct-systems verdict is priced while staged and lands only from the /duct-systems door (`rulingsDoor`,
 * `@pe/ducts-host/action-runtime`), so none is sent or deleted here.
 */
export function fanRulings(design: DuctActionPreparation["design"], snapshot: Pick<DuctSnapshot, "nodes" | "segments" | "store">, appliedAt: string) {
  const { roles } = storeRulings(stagedValues(withStoredRulings(design, snapshot.store, snapshot), design), snapshot.store, appliedAt, snapshot);
  // The native store overlays per key (K3): a role Work takes back is removed only by naming it here.
  return { rulings: { roles }, storeDeletes: { roles: Object.keys(snapshot.store?.roles ?? {}).filter((id) => !(id in roles)).map(Number) } };
}

async function prepareLosses(p: DuctActionPreparation) {
  let { intent, read, readNative, snapshot, design, doc, fans, firm, pointer, deps, appliedAt, flow } = p;

            const walk = intent.walk;
            if (!walk) throw refused("Preview needs writeIntent.walk from the fan roster; stage a scope before previewing losses");
            const tables = await readNative("ducts.tables", { ids: TABLE_IDS });
            const grids = toGrids(tables);
            const catalogs = await runPods(deps, catalogsFor(deps.files!, pointer));
            const work = workLayer(design);
            // One fan port's calc inputs, as its worksheet reads them: its walk, the far side of accepted joins, and the ruled roster.
            const inputOf = async (fan: { unitId: number; portIndex: number }, near: DuctSnapshot) => {
              const layers = (s: DuctSnapshot) => ({ terminalFlow: flow?.terminalFlow, snapshot: s, firm, store: s.store ?? undefined, work, catalogs: catalogs.tables });
              const walked = await followAcceptedJoins(near, resolveInputs(layers(near)).rulings.joins, (unitId) => read({ kind: "from", unitId }));
              const inputs = resolveInputs(layers(walked));
              // Ruled kinds and roles alone; a unit whose kind or role did not resolve is left for the roster to suggest.
              const roster = suggestRoster(walked, [], {
                kinds: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.kind.status === "valid" ? [[id, u.kind.value]] : []))),
                roles: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.role.status === "valid" ? [[id, u.role.value]] : []))),
              });
              return { walked, input: { terminalFlowNote: flow?.terminalFlowNote, snapshot: walked, fan, roster: [...roster.fans, ...roster.suggestions], grids, inputs, encounterRulings: encounterRulings({ work }) } satisfies BuildCalcInput };
            };
            const { walked, input } = await inputOf(walk, snapshot);
            snapshot = walked;
            if (snapshot.walk?.truncated)
              throw refused("The fan walk or an accepted continuation is truncated; no writes can be previewed");
            // P-060: a type-owned ESP slot is one value for every unit of the type, so each peer's own calc is built here
            // (P-061: in this process, from its own walk) and the mint refuses unless all are complete and equal.
            const cohorts: CalcSnapshot["parameterCohorts"] = snapshot.parameterCohorts;
            const peers = cohorts
              ?.find((c) => c.owner.kind === "type" && c.parameter === snapshot.slots.requiredEsp && c.members.some((m) => m.elementId === walk.unitId))
              ?.members.filter((m) => m.elementId !== walk.unitId) ?? [];
            // P-065: every peer claim is built in this prepare call from the peer's own native `from` walk, read here after the fan's; none is cached or carried between calls.
            const peerClaims = new Map<number, DomainClaim>();
            for (const { elementId: unitId } of peers)
              peerClaims.set(unitId, buildCalc((await inputOf({ unitId, portIndex: walk.portIndex }, await read({ kind: "from", unitId }))).input).claim);
            // Out-of-band rule evidence selects only fittings whose rule cells are in scope.
            // A fitting write can use only a table already saved by /duct-systems.
            const cells = [...(doc.writeIntent.edit?.value?.cells ?? []), ...fanWriteCells(fans, snapshot)];
            // Timestamp is authored-revision stable; wall time would invalidate an identical preview.
            const { claim, legs, request, fittingRules } = fanWriteRequest(input, { appliedAt: appliedAt ?? "", slots: snapshot.slots, peerClaims, ...fanRulings(design, snapshot, appliedAt ?? "") });
            const scoped = scopeApplyRequest(request, snapshot.store, cells, snapshot, fittingRules);
            const fittingIds = new Set(scoped.fittings.map((fitting) => fitting.id));
            for (const { elementId, evidence } of Object.values(legs)) {
              if (!fittingIds.has(elementId) || evidence.kind !== "coefficient") continue;
              const { rule, table } = evidence;
              if (snapshot.store?.rules?.[rule]?.table?.toUpperCase() !== table.toUpperCase())
                throw refused(`Rule ${rule} uses table ${table}. Save it on /duct-systems before writing its fitting coefficients.`, "ducts.rule-unsaved");
            }
            const unwritten = unwrittenCells(scoped, cells, snapshot);
            if (unwritten.length)
              throw refused(
                `These requested cells derive no write in this scope: ${unwritten
                  .map((cell) => `${cell.join("/")} (${unwrittenReason(stagedValues(doc, fans), cell)})`)
                  .join("; ")}`,
              );
            const label = elementLabeler(snapshot, { unique: true });
            return {
              cells,
              subjects: Object.fromEntries(cells.filter(([s]) => ["terminalDrops", "componentDrops", "flows", "equipmentFlows", "roles"].includes(s)).map(([, k]) => [k, String(workElementId(snapshot, k))])),
              input: scoped as unknown as Record<string, unknown>,
              // The required ESP has no Work cell (R1): a complete claim's equipment rows are a write on their own.
              // D9: only what this apply sends counts; a staged /duct-systems cell is not a fans write.
              nothingToWrite: !pendingRulings(design, snapshot.store, snapshot).some((delta) => delta.segment === "roles")
                && [scoped.fittings, scoped.terminals, scoped.components, scoped.equipment, scoped.terminalFlows, scoped.equipmentFlows].every((rows) => rows.length === 0),
              labels: Object.fromEntries(snapshot.nodes.map((n) => [String(n.id), label(n.id)])),
              // R1 (root ruling 20:25): the write's author is the caller who applies it; its ref is the claim's basis.
              claim: { basis: claim.basis, requiredEspInWg: claim.requiredEspInWg },
              dependencies: {
                snapshot: ductWriteEvidence(snapshot),
                grids,
                catalogs: catalogs.tables,
                firm,
              },
            };

}

export function fansExecutors(bridge: RevitBridge["Service"], deps: DuctActionDependencies = {}) {
  return ductActionExecutors({
    snapshot: lossSnapshot, derive: prepareLosses,
    entry: { key: "ducts.apply", native: "ducts.apply.plan",
      refusePlan: value => lossPlanRefusal((value as DuctsApply.Res.Response).writes),
      retires: (input, value, subjects, cells) => appliedCellPaths(input as unknown as DuctsApplyInput, value as DuctsApply.Res.Response, subjects, cells) },
    bindings: [["sheet.plan", "losses", "plan"], ["sheet.apply", "losses", "apply"]],
  }, bridge, deps);
}
