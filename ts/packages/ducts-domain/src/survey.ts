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
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

export interface Survey {
  snapshot: DuctSnapshot;
  flows: Map<number, TerminalFlow>;
  /** Every unit's design flow: staged `equipmentFlows`, else Revit's `fanFlow` fact. */
  equipmentFlows: Map<number, EquipmentFlow>;
  findings: DuctFinding[];
  /** The element pairs only a proximity inference joins; a path stepping across one rests on it. */
  inferred: InferredLink[];
}

const PERSON = new Set(["open-end", "no-root", "multi-root", "no-terminal-flow"]);

/**
 * A group with no air mover (no root, or every root a staged passive unit) has no duct path to a
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
      note: g.rootIds.length
        ? `no duct path to a fan: ${g.id} is fed only by passive ${g.rootIds.join(", ")}`
        : `no duct path to a fan: ${g.id} has no equipment connected to it`,
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
const last = new WeakMap<DuctSnapshot, { work: DuctsRouteDocument | null; survey: Survey }>();

export function survey(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
  roomFlows?: RoomFlows,
): Survey {
  const hit = last.get(snapshot);
  if (!roomFlows && hit && hit.work === work) return hit.survey;
  const t = tolerated(snapshot, work);
  const staged = stagedDucts(work);
  const tags = (staged.loads.preview?.systems ?? []).flatMap((x) => (x.tag ? [x.tag] : [])).sort();
  const bySeries = inSeries.get(t.snapshot) ?? inSeries.set(t.snapshot, new Map()).get(t.snapshot)!;
  const s =
    bySeries.get(tags.join("|")) ??
    bySeries.set(tags.join("|"), series(t.snapshot, new Set(tags))).get(tags.join("|"))!;
  const trees = s.snapshot.groups.map((g) => groupTree(s.snapshot, g.id));
  const flows = terminalFlows(s.snapshot, staged.loads.preview, staged.flows, trees, roomFlows);
  const noFan = noFanFindings(
    s.snapshot,
    new Set(
      Object.entries(staged.roles).flatMap(([id, { role }]) =>
        role === "passive" ? [Number(id)] : [],
      ),
    ),
  );
  const fanless = new Set(noFan.map((f) => f.groupId));
  const findings: DuctFinding[] = [
    ...s.findings,
    ...noFan,
    // An inference is likely, never correct (kaitpw 2026-10-19): a person rules on every one.
    ...t.findings.map((f) => ({
      ...f,
      assumed: ASSUMES.has(f.kind) ? f.note : null,
      clearer: "person" as const,
    })),
    ...flows.findings.map(flowFinding),
    ...s.snapshot.issues
      .filter((i) => !(i.kind === "no-root" && fanless.has(i.groupId)))
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        elementIds: i.elementId == null ? [] : [i.elementId],
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
    snapshot: s.snapshot,
    flows: flows.flows,
    equipmentFlows: equipmentFlows(s.snapshot, staged.equipmentFlows),
    findings,
    inferred: t.links,
  };

  if (!roomFlows) last.set(snapshot, { work, survey: result });
  return result;
}
