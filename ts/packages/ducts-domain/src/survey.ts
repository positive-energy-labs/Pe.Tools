// U4 wires the real fans Work for callers without one.
import { neutralFansWork } from "@pe/agent-contracts";
/**
 * What the route runs before any tree or loss (pressure-drop ledger, 2026-10-16): the snapshot
 * read in Work's working phase (`phases.ts`) and tolerated (`proximity.ts`), every terminal's design flow resolved (`terminal-flows.ts`), and
 * the findings of both beside the snapshot's own issues, each naming who clears it. Cached per
 * snapshot for the last Work, so `price` and `assessDucts` share one survey; the tolerated
 * snapshot is cached per proximity verdict set, so a edit number re-solves only `next`.
 */
import {
  stagedDucts,
  workingPhaseOf,
  type DuctFinding,
  type DuctsDesign,
} from "@pe/agent-contracts";

import { byFlow, groupFans } from "./fan-sections.ts";
import { passThrough } from "./pass-through.ts";
import { phased } from "./phases.ts";
import { tolerate, type InferredLink } from "./proximity.ts";
import {
  equipmentFlows,
  markOf,
  terminalFlows,
  type EquipmentFlow,
  type FlowFinding,
  type RoomFlows,
  type TerminalFlow,
} from "./terminal-flows.ts";
import { withStoredRulings } from "./rulings.ts";
import { groupTree } from "./topology.ts";
import { passiveOf, unitRoles, type UnitRole } from "./unit-roles.ts";
import type { DuctSnapshot } from "./types.ts";
import { elementLabeler } from "./element-label.ts";

export interface Survey {
  snapshot: DuctSnapshot;
  flows: Map<number, TerminalFlow>;
  /** Every unit's design flow: edit `equipmentFlows`, else Revit's `fanFlow` fact, else (a fan) the sum of the terminal flows it serves, `derived`. */
  equipmentFlows: Map<number, EquipmentFlow>;
  /**
   * Each group's fans with the flow the solve prices them at there (`groupFans`): stated, else the
   * sum of the grilles the fan serves in that group (`derived`), else none. Read a unit's flow for a
   * system through `unitFlowIn`, never `equipmentFlows`' largest-over-every-group reading.
   */
  fanFlows: Map<string, Map<number, EquipmentFlow>>;
  /** Every root unit's role: ruled, edit, else proposed from its design flow (`unit-roles.ts`). */
  roles: Map<number, UnitRole>;
  findings: DuctFinding[];
  /** The element pairs only a proximity inference joins; a path stepping across one rests on it. */
  inferred: InferredLink[];
}

const PERSON = new Set(["open-end", "near-miss", "no-terminal-flow"]);

/**
 * A group with no air mover (no root, or every root a passive unit) has no duct path to a
 * fan, so it prices nothing (`losses.ts`) and says so once. Model health never names a group
 * (ducts LEDGER 2026-10-29), so this group-level finding is the route's own.
 */
function noFanFindings(snapshot: DuctSnapshot, passive: ReadonlySet<number>): DuctFinding[] {
  return snapshot.groups
    .filter((g) => !g.rootIds.some((id) => !passive.has(id)))
    .map((g) => ({
      id: `no-fan:${g.id}`,
      kind: "no-fan",
      elementIds: snapshot.nodes
        .filter((n) => n.groupId === g.id && n.kind === "terminal")
        .map((n) => n.id),
      groupId: g.id,
      note: ((inline) =>
        g.rootIds.length || inline.length
          ? `no duct path to a fan: ${g.id} is fed only by passive ${[...g.rootIds, ...inline].join(", ")}`
          : `no duct path to a fan: ${g.id} has no equipment connected to it`)(
        snapshot.nodes.filter((n) => n.groupId === g.id && n.kind === "equipment").map((n) => n.id),
      ),
      assumed: null,
      clearer: "person" as const,
    }));
}
/** The inferences the route acts on; a near miss or a loop it only reports. */
const ASSUMES = new Set([
  "joined-by-proximity",
  "tap-by-proximity",
  "inline-by-inference",
  "out-of-phase",
]);

const flowFinding =
  (name: (id: number) => string) =>
  (f: FlowFinding): DuctFinding => ({
    id: `flow:no-flow:${f.terminal}`,
    kind: f.kind,
    elementIds: [f.terminal],
    note: `${name(f.terminal)} has no design flow: no override, no rooms share, no positive Revit flow`,
    assumed: null,
    clearer: "pea",
  });

/** The edit verdicts proximity reads (ignore withholds, connect joins across classifications) and the working phase. */
const verdictKey = (work: DuctsDesign | null) =>
  Object.entries(work?.assumptions ?? {})
    .flatMap(([key, cell]) => {
      const v = cell.edit?.value;
      return key.startsWith("proximity:") && v?.kind === "verdict" ? [`${key}=${v.verdict}`] : [];
    })
    .sort()
    .concat(`phase=${workingPhaseOf(work) ?? ""}`)
    .join("|");

const cache = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof tolerate>>>();
/**
 * `tolerate` over the snapshot in Work's working phase, under Work's edit proximity verdicts,
 * the `out-of-phase` findings first; cached per snapshot, verdict set and phase.
 */
export function tolerated(snapshot: DuctSnapshot, work: DuctsDesign | null) {
  const byVerdicts = cache.get(snapshot) ?? cache.set(snapshot, new Map()).get(snapshot)!;
  const key = verdictKey(work);
  const hit = byVerdicts.get(key);
  if (hit) return hit;
  const inPhase = phased(snapshot, work);
  const t = tolerate(inPhase.snapshot, work);
  const result = inPhase.findings.length
    ? { ...t, findings: [...inPhase.findings, ...t.findings] }
    : t;
  byVerdicts.set(key, result);
  return result;
}
const inline = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof passThrough>>>();
const last = new WeakMap<DuctSnapshot, { work: DuctsDesign | null; survey: Survey }>();

export function survey(
  snapshot: DuctSnapshot,
  work: DuctsDesign | null,
  roomFlows?: RoomFlows,
): Survey {
  // The model's stored rulings are the base under Work's pending ones (`rulings.ts`).
  work = withStoredRulings(work, snapshot.store);
  const hit = last.get(snapshot);
  if (!roomFlows && hit && hit.work === work) return hit.survey;
  const t = tolerated(snapshot, work);
  const edit = stagedDucts(work, work ?? neutralFansWork);
  // Roles are proposed on the groups as Revit cuts them; then a passive unit passes air through.
  const units = equipmentFlows(t.snapshot, edit.equipmentFlows);
  const roles = unitRoles(t.snapshot, units, edit.roles);
  const passive = passiveOf(roles);
  const key = [...passive].join(",");
  const byPassive = inline.get(t.snapshot) ?? inline.set(t.snapshot, new Map()).get(t.snapshot)!;
  const p = byPassive.get(key) ?? byPassive.set(key, passThrough(t.snapshot, passive)).get(key)!;
  const m = p.snapshot;
  const flows = terminalFlows(m, edit.flows, roomFlows);
  const noFan = noFanFindings(m, passive);
  // A fan that states no flow takes the sum of the terminal flows it serves in each group (nearest
  // port wins, `groupFans`), shown as derived and never written. The solve prices each group from
  // that group's own sum; this per-unit reading is the largest over the groups it roots.
  const nodeOf = new Map(m.nodes.map((n) => [n.id, n]));
  const nameOf = (id: number) => markOf(nodeOf.get(id)) ?? String(id);
  const derived = new Map(units);
  const fanFlows = new Map<string, Map<number, EquipmentFlow>>();
  const multiFan: DuctFinding[] = [];
  for (const g of m.groups) {
    const roots = g.rootIds.filter((id) => !passive.has(id));
    if (!roots.length) continue;
    const fans = groupFans(
      () => groupTree(m, g.id),
      roots,
      (id) => units.get(id)?.cfm,
      (t) => flows.flows.get(t)?.cfm ?? 0,
    );
    fanFlows.set(
      g.id,
      new Map(
        fans.map((f) => [
          f.unit,
          f.served
            ? { cfm: f.cfm, source: "derived", grilles: f.served.length }
            : (units.get(f.unit) ?? { cfm: null, source: null }),
        ]),
      ),
    );
    for (const f of fans)
      if (f.served && f.cfm! > (derived.get(f.unit)?.cfm ?? 0))
        derived.set(f.unit, { cfm: f.cfm, source: "derived", grilles: f.served.length });
    // Several fans price per fan (`fan-sections.ts`) and never block: a Diagnostics line names the
    // split in this group's own flows; a fan whose flow is unknown is the unit flow Set row's, not a Fix.
    if (fans.length < 2) continue;
    const word = (f: (typeof fans)[number]) =>
      f.cfm == null
        ? "flow unknown"
        : `${f.cfm} cfm${f.served ? ` (sum of ${f.served.length} grille${f.served.length === 1 ? "" : "s"})` : ""}`;
    const [lead, ...rest] = byFlow(fans);
    multiFan.push({
      id: `multi-fan:${g.id}`,
      kind: "multi-fan",
      groupId: g.id,
      elementIds: [lead!, ...rest].map((f) => f.unit),
      note: `priced per fan: ${nameOf(lead!.unit)} ${word(lead!)} owns the trunk; ${rest
        .map((f) => `${nameOf(f.unit)} ${word(f)} owns its port to the first junction`)
        .join("; ")}`,
      assumed: null,
      clearer: "person" as const,
    });
  }
  const findings: DuctFinding[] = [
    ...noFan,
    ...p.findings,
    ...multiFan,
    // An inference is likely, never correct (kaitpw 2026-10-19): a person rules on every one.
    ...t.findings.map((f) => ({
      ...f,
      assumed: ASSUMES.has(f.kind) ? f.note : null,
      clearer: "person" as const,
    })),
    ...flows.findings.map(flowFinding(elementLabeler(snapshot))),
    ...m.issues.map((i) => ({
      id: i.id,
      kind: i.kind,
      elementIds: [i.elementId],
      note: i.note,
      assumed: null,
      clearer: PERSON.has(i.kind) ? ("person" as const) : ("route" as const),
    })),
  ];
  const result = {
    snapshot: m,
    flows: flows.flows,
    equipmentFlows: derived,
    fanFlows,
    roles,
    findings,
    inferred: t.links,
  };

  if (!roomFlows) last.set(snapshot, { work, survey: result });
  return result;
}

/**
 * A unit's design flow as one system reads it: a stated flow as is; a derived one is the sum of the
 * grilles it serves in `groups` alone, the flow those groups are priced at (SA 19, Project A: DH-21
 * serves no SA 19 grille, so it reads no flow there, never RA 38's 768 cfm). With no `groups`, the
 * whole document's reading. A fan serving none of them states none: the unit flow Set row's.
 */
export function unitFlowIn(
  surveyed: Pick<Survey, "equipmentFlows" | "fanFlows">,
  unit: number,
  groups: readonly string[] | null,
): EquipmentFlow {
  const flow = surveyed.equipmentFlows.get(unit) ?? { cfm: null, source: null };
  if (!groups || (flow.cfm != null && flow.source !== "derived")) return flow;
  const there = groups.flatMap((g) => {
    const f = surveyed.fanFlows.get(g)?.get(unit);
    return f?.source === "derived" && f.cfm != null ? [f] : [];
  });
  return there.length
    ? {
        cfm: there.reduce((a, f) => a + f.cfm!, 0),
        source: "derived",
        grilles: there.reduce((a, f) => a + (f.grilles ?? 0), 0),
      }
    : { cfm: null, source: null };
}

/** Every unit's flow as one system reads it (`unitFlowIn`); the Set rows and the Inputs pane read the same. */
export const unitFlowsIn = (
  surveyed: Pick<Survey, "equipmentFlows" | "fanFlows">,
  groups: readonly string[] | null,
): Map<number, EquipmentFlow> =>
  new Map([...surveyed.equipmentFlows.keys()].map((id) => [id, unitFlowIn(surveyed, id, groups)]));
