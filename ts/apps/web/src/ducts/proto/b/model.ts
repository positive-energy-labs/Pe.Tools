/**
 * The profiler tree E2 reads: system -> runs (fan to terminal) -> legs (`legsOf` over the run's path) -> elements.
 * Loss comes only from `priced.now.paths`: an element's self is the sum of its rows' dp on that path, its
 * total the running sum from the fan. With no priced result every number is null (never a stand-in figure).
 */
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { Provisional, Row } from "@pe/ducts-domain/losses";
import { systemsOf } from "@pe/ducts-domain/system-scope";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { elementNamer } from "../../claims";
import { groupLabels } from "../../inputs";
import { labelOfNode, legsOf } from "../../legs";

export type TreeKind = "system" | "run" | "leg" | "element";

/** One end of a run's loss: its in-wg and the elements that pay it (the set a hover lights). */
export interface SplitPart {
  dp: number;
  ids: number[];
  /** Rows in this part with no drop (a grille with no catalog link): the part is unknown, never 0. */
  unpriced: number;
}
/**
 * A whole run's loss in three: the unit end (passive devices in series with the fan: a coil, a
 * dehu), the ducts and fittings between, and the terminal's drop. The fan is not a part: it is the
 * whole, the largest run's total.
 */
export interface Split {
  unit: SplitPart;
  duct: SplitPart;
  terminal: SplitPart;
}

/** A path's rows dealt to the three parts by what each row prices. */
export function splitOf(rows: readonly Row[], equipment: ReadonlySet<number>): Split {
  const part = (): SplitPart => ({ dp: 0, ids: [], unpriced: 0 });
  const split: Split = { unit: part(), duct: part(), terminal: part() };
  for (const row of rows) {
    const to = row.kind === "terminal" ? split.terminal : equipment.has(row.id) ? split.unit : split.duct;
    if (row.dp == null || row.error) to.unpriced++;
    to.dp += row.dp ?? 0;
    if (!to.ids.includes(row.id)) to.ids.push(row.id);
  }
  return split;
}

export interface TreeNode {
  key: string;
  kind: TreeKind;
  name: string;
  /** The element id a select/hover sends: system → root element, run → terminal, leg → first id. */
  id: number | null;
  /** Cumulative loss from the fan to the far end of this node, in-wg; null unpriced. */
  total: number | null;
  /** This node's own loss, in-wg; null unpriced. */
  self: number | null;
  /** Effective length from the fan to the far end of this node, ft (`equivalent-length.ts`); null unpriced. */
  ft: number | null;
  /** This node's own effective length, ft: its straight length plus its fittings and terminal as equivalent feet. */
  selfFt: number | null;
  /** A duct element's own actual friction rate, in-wg per 100 ft on this path; null on any other node. */
  rate: number | null;
  /** Why `self` is null on a priced path: the word the row shows (`no drop`, `unpriced`) and the reason. */
  unpriced: { word: string; why: string } | null;
  /** A run's loss in three parts (the system row carries its critical run's); null elsewhere or unpriced. */
  split: Split | null;
  /** Bar scale: the group's fan. */
  scale: number | null;
  critical: "pe" | "longest" | null;
  provisional: Provisional;
  /** A run's level (where its grille is), else null. */
  level: string | null;
  /** The run's terminal this node lies on (for the loss rows in the edit popover). */
  terminal: number | null;
  children: TreeNode[];
}

/** The known parts of a stretch added up; null only when none is known (a stretch is never a guess). */
const sumKnown = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

/**
 * A path's rows dealt to the path's own elements. A row names the element it prices, but the loss a
 * path pays passing a tap (`tap-straight`, on the tap fitting or a synthetic id) names an element off
 * the path: it is charged to the main-line element whose rows it follows, so the stretches add up to
 * the run's total and no part of it is lost between rows and tree.
 */
export function rowsByElement(path: readonly number[], rows: readonly Row[]): Map<number, Row[]> {
  const on = new Set(path);
  const out = new Map<number, Row[]>(path.map((id) => [id, []]));
  let owner = path[0];
  for (const row of rows) {
    if (on.has(row.id)) owner = row.id;
    if (owner != null) out.get(owner)!.push(row);
  }
  return out;
}

/** An element's own loss from its rows: null when it has rows and none is priced. */
const selfOfRows = (rows: readonly Row[]) =>
  rows.length && rows.every((r) => r.dp == null)
    ? null
    : rows.reduce((a, r) => a + (r.dp ?? 0), 0);

/** An element's own effective length from its rows, ft: null when it has rows and none has feet. */
const selfFtOfRows = (rows: readonly Row[]) =>
  rows.length && rows.every((r) => r.eqFt == null) ? null : rows.reduce((a, r) => a + (r.eqFt ?? 0), 0);

/** A duct's actual friction rate on a path from its friction rows, in-wg per 100 ft; null for a part with none. */
const rateOfRows = (rows: readonly Row[]) => {
  const run = rows.filter((r) => r.kind === "friction" && r.lengthFt != null);
  const length = run.reduce((a, r) => a + r.lengthFt!, 0);
  const dp = run.reduce((a, r) => a + (r.dp ?? 0), 0);
  return length > 1e-9 && dp > 0 ? (dp / length) * 100 : null;
};

const unpricedOf = (rows: readonly Row[]): TreeNode["unpriced"] => {
  const bad = rows.find((r) => r.dp == null);
  if (!bad) return null;
  return {
    word: bad.kind === "terminal" ? "no drop" : "unpriced",
    why: bad.error ?? bad.desc,
  };
};

/**
 * One section per group in `only` (every group when empty), in that order. `sectionName` names a
 * section the way the system reads it ("SA 19 · FC-17 · shared with RA 1"); else its group label.
 */
export function buildTree(
  snapshot: DuctSnapshot,
  priced: Priced | null,
  work: DuctsRouteDocument | null,
  only: readonly string[] = [],
  sectionName?: (group: string) => string,
): TreeNode[] {
  const nameOf = elementNamer(snapshot, null);
  const name = (id: number) => nameOf(id) ?? "element not in snapshot";
  const labelOf = labelOfNode(snapshot);
  const labels = groupLabels(snapshot);
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const byId = new Map(snapshot.groups.map((g) => [g.id, g]));
  const groups = only.length ? only.flatMap((id) => byId.get(id) ?? []) : snapshot.groups;
  return groups.map((group) => {
    const tree = groupTree(snapshot, group.id);
    const runs = runsOf(tree);
    const solved = priced?.now.byGroup[group.id] ?? null;
    const peCritical = solved?.critical ?? null;
    const longest = tree.longest.at(-1) ?? null;
    const fan = solved?.fan ?? null;
    const rootId = tree.root?.equipment ?? tree.root?.element ?? null;
    const rootName = rootId == null ? "no air mover" : name(rootId);
    const runNodes = runs.map((run): TreeNode => {
      const path = priced?.now.paths[run.terminal] ?? null;
      const owned = path ? rowsByElement(run.path, path.rows) : null;
      const selfOf = (id: number) => (owned ? selfOfRows(owned.get(id) ?? []) : null);
      const selfFtOf = (id: number) => (owned ? selfFtOfRows(owned.get(id) ?? []) : null);
      const running = new Map<number, number | null>();
      const runningFt = new Map<number, number | null>();
      let acc = 0;
      let accFt = 0;
      for (const id of run.path) {
        acc += selfOf(id) ?? 0;
        accFt += selfFtOf(id) ?? 0;
        running.set(id, path ? acc : null);
        runningFt.set(id, path ? accFt : null);
      }
      const cut = legsOf(snapshot, run.path, labelOf, work);
      const runKey = `${group.id}/r${run.terminal}`;
      const legs = cut.legs.map((leg, i): TreeNode => {
        const members = [
          ...(i === 0 && leg.from.kind !== "open" && leg.from.kind !== "level" ? [leg.from.id] : []),
          ...leg.ids,
          ...(leg.to.kind !== "open" && leg.to.kind !== "level" ? [leg.to.id] : []),
        ].filter((id) => run.path.includes(id));
        const elements = members.map(
          (id): TreeNode => ({
            key: `${runKey}/l${i}/e${id}`,
            kind: "element",
            name: name(id),
            id,
            total: running.get(id) ?? null,
            self: selfOf(id),
            ft: runningFt.get(id) ?? null,
            selfFt: selfFtOf(id),
            rate: owned ? rateOfRows(owned.get(id) ?? []) : null,
            unpriced: owned ? unpricedOf(owned.get(id) ?? []) : null,
            split: null,
            level: null,
            scale: fan,
            critical: null,
            provisional: null,
            terminal: run.terminal,
            children: [],
          }),
        );
        const last = members.at(-1);
        return {
          key: `${runKey}/l${i}`,
          kind: "leg",
          // The path's first element is the one the air mover feeds: that stretch starts at the unit.
          name: i === 0 && leg.from.kind === "open" ? `${rootName} → ${leg.to.name}` : leg.name,
          id: leg.ids[0] ?? leg.to.id,
          total: last == null ? null : (running.get(last) ?? null),
          self: path ? sumKnown(elements.map((e) => e.self)) : null,
          ft: last == null ? null : (runningFt.get(last) ?? null),
          selfFt: path ? sumKnown(elements.map((e) => e.selfFt)) : null,
          rate: null,
          unpriced: null,
          split: null,
          level: null,
          scale: fan,
          critical: null,
          provisional: null,
          terminal: run.terminal,
          children: elements,
        };
      });
      const runLevel = [...cut.legs].reverse().find((l) => l.levelId != null)?.levelId;
      return {
        key: runKey,
        kind: "run",
        name: `${rootName} → ${name(run.terminal)}`,
        level: snapshot.levels.find((l) => l.id === runLevel)?.name ?? null,
        id: run.terminal,
        total: path?.total ?? null,
        self: null,
        ft: path?.tel ?? null,
        selfFt: null,
        rate: null,
        unpriced: null,
        split: path ? splitOf(path.rows, equipment) : null,
        scale: fan,
        critical:
          peCritical != null
            ? run.terminal === peCritical
              ? "pe"
              : null
            : run.terminal === longest
              ? "longest"
              : null,
        provisional: path?.provisional ?? null,
        terminal: run.terminal,
        children: legs,
      };
    });
    return {
      key: group.id,
      kind: "system",
      name: sectionName?.(group.id) ?? labels.get(group.id) ?? rootName,
      id: rootId,
      total: fan,
      self: null,
      ft: solved?.criticalTel ?? null,
      selfFt: null,
      rate: null,
      unpriced: null,
      split: runNodes.find((r) => r.terminal === peCritical)?.split ?? null,
      level: null,
      scale: fan,
      critical: null,
      provisional: solved?.provisional ?? null,
      terminal: null,
      children: runNodes.sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0)),
    };
  });
}

/** The rows a person can see: depth-first, children only under expanded keys. */
export function visibleRows(
  roots: readonly TreeNode[],
  open: ReadonlySet<string>,
): { node: TreeNode; depth: number; parent: string | null }[] {
  const out: { node: TreeNode; depth: number; parent: string | null }[] = [];
  const walk = (nodes: readonly TreeNode[], depth: number, parent: string | null) => {
    for (const node of nodes) {
      out.push({ node, depth, parent });
      if (open.has(node.key)) walk(node.children, depth + 1, node.key);
    }
  };
  walk(roots, 0, null);
  return out;
}

/**
 * No groups (the scene fixture carries none): the subject's ordered ids stand in as one run under
 * one "subject" system, cut into legs by `legsOf`. Unpriced: a subject has no fan or terminal path.
 */
export function subjectTree(
  snapshot: DuctSnapshot,
  ids: readonly number[],
  work: DuctsRouteDocument | null,
): TreeNode {
  const nameOf = elementNamer(snapshot, null);
  const name = (id: number) => nameOf(id) ?? "element not in snapshot";
  const cut = legsOf(snapshot, ids, labelOfNode(snapshot), work);
  const blank = { total: null, self: null, ft: null, selfFt: null, rate: null, unpriced: null, split: null, level: null, scale: null, critical: null, provisional: null, terminal: null };
  const legs = cut.legs.map(
    (leg, i): TreeNode => ({
      ...blank,
      key: `subject/r/l${i}`,
      kind: "leg",
      name: leg.name,
      id: leg.ids[0] ?? leg.to.id,
      children: [
        ...(i === 0 && ids.includes(leg.from.id) ? [leg.from.id] : []),
        ...leg.ids,
        ...(ids.includes(leg.to.id) ? [leg.to.id] : []),
      ].map((id) => ({ ...blank, key: `subject/r/l${i}/e${id}`, kind: "element", name: name(id), id, children: [] })),
    }),
  );
  const first = cut.nodes[0]?.name ?? "start";
  const last = cut.nodes.at(-1)?.name ?? "end";
  return {
    ...blank,
    key: "subject",
    kind: "system",
    name: "subject (no group in this snapshot)",
    id: ids[0] ?? null,
    children: [{ ...blank, key: "subject/r", kind: "run", name: `${first} → ${last}`, id: ids.at(-1) ?? null, children: legs }],
  };
}

/**
 * The system list: one childless row per Revit system (no run tree is built, so 350 systems stay
 * cheap), keyed by its name. Its total is the largest fan over the groups it is in; `fanless` when
 * none of them has an air mover.
 */
export function systemList(
  snapshot: DuctSnapshot,
  priced: Priced | null,
): (TreeNode & { fanless: boolean; sub: string })[] {
  return systemsOf(snapshot).map((system) => {
    const solved = system.groups.flatMap((g) => priced?.now.byGroup[g] ?? []);
    const totals = solved.filter((s) => s.critical != null).map((s) => s.fan);
    const first = snapshot.groups.find((g) => g.id === system.groups[0]);
    return {
      key: system.name,
      kind: "system",
      name: system.name,
      sub: [
        system.classification,
        system.units.join(", ") || "no fan",
        system.groups.length > 1 ? `${system.groups.length} networks` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      fanless: !!priced && solved.length > 0 && solved.every((s) => !s.hasAirMover),
      id: first?.rootIds[0] ?? null,
      total: totals.length ? Math.max(...totals) : null,
      self: null,
      ft: null,
      selfFt: null,
      rate: null,
      unpriced: null,
      split: null,
      level: null,
      scale: null,
      critical: null,
      provisional: solved.find((s) => s.provisional)?.provisional ?? null,
      terminal: null,
      children: [],
    };
  });
}

/** Every element id of one group: its segments, its nodes and its roots. */
export function groupElementIds(snapshot: DuctSnapshot, groupId: string): Set<number> {
  const ids = new Set<number>();
  for (const s of snapshot.segments) if (s.groupId === groupId) ids.add(s.id);
  for (const n of snapshot.nodes) if (n.groupId === groupId) ids.add(n.id);
  for (const g of snapshot.groups) if (g.id === groupId) for (const r of g.rootIds) ids.add(r);
  return ids;
}
