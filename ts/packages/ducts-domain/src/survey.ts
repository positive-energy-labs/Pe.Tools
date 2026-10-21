/**
 * What the route runs before any tree or loss (pressure-drop ledger, 2026-10-16): the snapshot
 * read in Work's working phase (`phases.ts`) and tolerated (`proximity.ts`), every terminal's design flow resolved (`terminal-flows.ts`), and
 * the findings of both beside the snapshot's own issues, each naming who clears it. Cached per
 * snapshot for the last Work, so `price` and `assessDucts` share one survey; the tolerated
 * snapshot is cached per proximity verdict set, so a staged number re-solves only `next`.
 */
import {
  stagedDucts,
  workingPhaseOf,
  type DuctFinding,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";

import { byFlow, servedBy } from "./fan-sections.ts";
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

export interface Survey {
  snapshot: DuctSnapshot;
  flows: Map<number, TerminalFlow>;
  /** Every unit's design flow: staged `equipmentFlows`, else Revit's `fanFlow` fact, else (a fan) the sum of the terminal flows it serves, `derived`. */
  equipmentFlows: Map<number, EquipmentFlow>;
  /** Every root unit's role: ruled, staged, else proposed from its design flow (`unit-roles.ts`). */
  roles: Map<number, UnitRole>;
  findings: DuctFinding[];
  /** The element pairs only a proximity inference joins; a path stepping across one rests on it. */
  inferred: InferredLink[];
}

const PERSON = new Set(["open-end", "no-root", "multi-root", "no-terminal-flow"]);

/**
 * A group with no air mover (no root, or every root a passive unit) has no duct path to a
 * fan, so it prices nothing (`losses.ts`) and says so once. It stands in for the group's `no-root`.
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

const flowFinding = (f: FlowFinding): DuctFinding => {
  switch (f.kind) {
    case "tag-without-mark":
      return {
        id: `flow:tag:${f.tag}`,
        kind: f.kind,
        elementIds: [],
        note: `load preview "${f.system}" is tagged ${f.tag}; no equipment carries that Mark`,
        assumed: null,
        clearer: "person",
      };
    case "mark-without-system":
      return {
        id: `flow:mark:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `equipment ${f.equipment} is marked ${f.mark}; the load preview has no system tagged ${f.mark}`,
        assumed: null,
        clearer: "person",
      };
    case "no-terminals":
      return {
        id: `flow:no-terminals:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `${f.mark} (${f.equipment}) roots no tree with a terminal; its load has nowhere to go`,
        assumed: null,
        clearer: "person",
      };
    case "no-mark":
      return {
        id: `flow:no-mark:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `${f.label} (${f.equipment}) feeds terminals but carries no Mark; no load preview system can match it`,
        assumed: null,
        clearer: "person",
      };
    case "no-flow":
      return {
        id: `flow:no-flow:${f.terminal}`,
        kind: f.kind,
        elementIds: [f.terminal],
        note: `terminal ${f.terminal} has no design flow: no override, no load preview share, no positive Revit flow`,
        assumed: null,
        clearer: "pea",
      };
  }
};

/** The staged verdicts proximity reads (ignore withholds, connect joins across classifications) and the working phase. */
const verdictKey = (work: DuctsRouteDocument | null) =>
  Object.entries(work?.assumptions ?? {})
    .flatMap(([key, cell]) => {
      const v = cell.staged?.value;
      return key.startsWith("proximity:") && v?.kind === "verdict" ? [`${key}=${v.verdict}`] : [];
    })
    .sort()
    .concat(`phase=${workingPhaseOf(work) ?? ""}`)
    .join("|");

/**
 * A group several units feed, where exactly one carries a Load Preview system, is that unit's
 * tree; the others sit in series on it (Chadds SA 19: an inline dehumidifier on FC-17's supply,
 * kaitpw 2026-10-16 "a dehu does not count"). Their air stays out of the calculation.
 */
export function series(snapshot: DuctSnapshot, tags: Set<string>) {
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const findings: DuctFinding[] = [];
  const dropped = new Set<string>();
  const groups = snapshot.groups.map((g) => {
    if (g.rootIds.length < 2) return g;
    const owners = g.rootIds.filter((id) => tags.has(markOf(nodeById.get(id)) ?? ""));
    if (owners.length !== 1) return g;
    const inline = g.rootIds.filter((id) => id !== owners[0]);
    dropped.add(g.id);
    findings.push({
      id: `series:${g.id}`,
      kind: "series-by-inference",
      elementIds: inline,
      note: `${inline.join(", ")} sit in series on ${markOf(nodeById.get(owners[0]!))} (${owners[0]}); only it has a load preview system`,
      assumed: "the inline units move no design air of their own",
      clearer: "pea",
    });
    return { ...g, rootIds: owners };
  });
  if (!dropped.size) return { snapshot, findings };
  const issues = snapshot.issues.filter(
    (i) => !(i.kind === "multi-root" && dropped.has(i.groupId)),
  );
  return { snapshot: { ...snapshot, groups, issues }, findings };
}

const cache = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof tolerate>>>();
/**
 * `tolerate` over the snapshot in Work's working phase, under Work's staged proximity verdicts,
 * the `out-of-phase` findings first; cached per snapshot, verdict set and phase.
 */
export function tolerated(snapshot: DuctSnapshot, work: DuctsRouteDocument | null) {
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
const inSeries = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof series>>>();
const inline = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof passThrough>>>();
const last = new WeakMap<DuctSnapshot, { work: DuctsRouteDocument | null; survey: Survey }>();

export function survey(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
  roomFlows?: RoomFlows,
): Survey {
  // The model's stored rulings are the base under Work's pending ones (`rulings.ts`).
  work = withStoredRulings(work, snapshot.store);
  const hit = last.get(snapshot);
  if (!roomFlows && hit && hit.work === work) return hit.survey;
  const t = tolerated(snapshot, work);
  const staged = stagedDucts(work);
  const tags = (staged.loads.preview?.systems ?? []).flatMap((x) => (x.tag ? [x.tag] : [])).sort();
  const bySeries = inSeries.get(t.snapshot) ?? inSeries.set(t.snapshot, new Map()).get(t.snapshot)!;
  const s =
    bySeries.get(tags.join("|")) ??
    bySeries.set(tags.join("|"), series(t.snapshot, new Set(tags))).get(tags.join("|"))!;
  // Roles are proposed on the groups as Revit cuts them; then a passive unit passes air through.
  const units = equipmentFlows(s.snapshot, staged.equipmentFlows);
  const roles = unitRoles(s.snapshot, units, staged.roles);
  const passive = passiveOf(roles);
  const key = [...passive].join(",");
  const byPassive = inline.get(s.snapshot) ?? inline.set(s.snapshot, new Map()).get(s.snapshot)!;
  const p = byPassive.get(key) ?? byPassive.set(key, passThrough(s.snapshot, passive)).get(key)!;
  const m = p.snapshot;
  const trees = m.groups.map((g) => groupTree(m, g.id));
  const flows = terminalFlows(m, staged.loads.preview, staged.flows, trees, roomFlows);
  const noFan = noFanFindings(m, passive);
  const fanless = new Set(noFan.map((f) => f.groupId));
  const rootsOf = (groupId: string) => m.groups.find((g) => g.id === groupId)?.rootIds ?? [];
  // A fan that states no flow takes the sum of the terminal flows it serves (nearest port wins),
  // shown as derived and never written; the largest of its groups' sums is its design flow.
  const derived = new Map(units);
  for (const g of m.groups) {
    const fans = g.rootIds.filter((id) => !passive.has(id));
    if (!fans.some((id) => units.get(id)?.cfm == null)) continue;
    const served = servedBy(groupTree(m, g.id), fans);
    for (const id of fans) {
      if (units.get(id)?.cfm != null) continue;
      const ts = served.get(id) ?? [];
      const cfm = ts.reduce((a, t) => a + (flows.flows.get(t)?.cfm ?? 0), 0);
      if (cfm > 0 && cfm > (derived.get(id)?.cfm ?? 0))
        derived.set(id, { cfm, source: "derived", grilles: ts.length });
    }
  }
  const flowWord = (id: number) => {
    const f = derived.get(id);
    return f?.cfm == null
      ? "flow unknown"
      : `${f.cfm} cfm${f.source === "derived" ? ` (sum of ${f.grilles} grille${f.grilles === 1 ? "" : "s"})` : ""}`;
  };
  const nodeOf = new Map(m.nodes.map((n) => [n.id, n]));
  const nameOf = (id: number) => markOf(nodeOf.get(id)) ?? String(id);
  // Several fans price per fan (`fan-sections.ts`) and never block: a Diagnostics line names the
  // split; a fan whose flow is unknown is the unit flow Set row's, not a Fix.
  const multiFan: DuctFinding[] = m.groups.flatMap((g) => {
    const fans = byFlow(
      g.rootIds
        .filter((id) => !passive.has(id))
        .map((unit) => ({ unit, cfm: derived.get(unit)?.cfm ?? null })),
    );
    if (fans.length < 2) return [];
    return [
      {
        id: `multi-fan:${g.id}`,
        kind: "multi-fan",
        groupId: g.id,
        elementIds: fans.map((f) => f.unit),
        note: `priced per fan: ${nameOf(fans[0]!.unit)} ${flowWord(fans[0]!.unit)} owns the trunk; ${fans
          .slice(1)
          .map((f) => `${nameOf(f.unit)} ${flowWord(f.unit)} owns its port to the first junction`)
          .join("; ")}`,
        assumed: null,
        clearer: "person" as const,
      },
    ];
  });
  const findings: DuctFinding[] = [
    ...s.findings,
    ...noFan,
    ...p.findings,
    ...multiFan,
    // An inference is likely, never correct (kaitpw 2026-10-19): a person rules on every one.
    ...t.findings.map((f) => ({
      ...f,
      assumed: ASSUMES.has(f.kind) ? f.note : null,
      clearer: "person" as const,
    })),
    ...flows.findings.map(flowFinding),
    ...m.issues
      .filter((i) => !(i.kind === "no-root" && fanless.has(i.groupId)))
      // Several roots price per fan (`multiFan`); the raw issue is not a blocker.
      .filter((i) => i.kind !== "multi-root")
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        ...(i.kind === "multi-root" || i.kind === "no-root" ? { groupId: i.groupId } : {}),
        // A group-level issue names the group's roots, so the person can select them.
        elementIds:
          i.elementId != null ? [i.elementId] : i.kind === "multi-root"
            ? rootsOf(i.groupId)
            : i.kind === "no-root"
              ? m.nodes.filter((n) => n.groupId === i.groupId && n.kind === "terminal").map((n) => n.id)
              : [],
        // Fan static is the route's output, not an input a person owes.
        note:
          i.kind === "no-fan-static"
            ? `${i.note}; computed by the route when the path prices`
            : i.note,
        assumed: null,
        clearer: PERSON.has(i.kind) ? ("person" as const) : ("route" as const),
      })),
  ];
  const result = {
    snapshot: m,
    flows: flows.flows,
    equipmentFlows: derived,
    roles,
    findings,
    inferred: t.links,
  };

  if (!roomFlows) last.set(snapshot, { work, survey: result });
  return result;
}
