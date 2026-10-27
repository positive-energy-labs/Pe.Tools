/**
 * The profiler tree E2 reads: system -> runs (fan to terminal) -> legs (`legsOf` over the run's path) -> elements.
 * Loss comes only from `priced.next` (the model plus the edit cells, what the person is looking at):
 * an element's self is the sum of its rows' dp on that path, its total the running sum from the fan.
 * Each run is drawn on the path it was priced on, from the fan whose section holds it; a smaller
 * fan whose worst run crosses its junction gets that run drawn too, so the critical ◆ (the worst
 * fan's run, `byGroup.criticalFan`) is always a row a person can see. With no priced result every
 * number is null (never a stand-in figure).
 */
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import { worstRun, type FanResult, type Provisional, type Row } from "@pe/ducts-domain/losses";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { splitOf, type Split } from "../../loss-split";
import { elementNamer } from "../../claims";
import { groupLabels } from "@pe/ducts-domain/words";
import { labelOfNode, legsOf } from "../../legs";

type TreeKind = "system" | "run" | "leg" | "element";

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
function rowsByElement(path: readonly number[], rows: readonly Row[]): Map<number, Row[]> {
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
  rows.length && rows.every((r) => r.dp == null) ? null : rows.reduce((a, r) => a + (r.dp ?? 0), 0);

/** An element's own effective length from its rows, ft: null when it has rows and none has feet. */
const selfFtOfRows = (rows: readonly Row[]) =>
  rows.length && rows.every((r) => r.eqFt == null)
    ? null
    : rows.reduce((a, r) => a + (r.eqFt ?? 0), 0);

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
  members?: ReadonlySet<number>,
): TreeNode[] {
  const nameOf = elementNamer(snapshot, null);
  const name = (id: number) => nameOf(id) ?? "element not in snapshot";
  const labelOf = labelOfNode(snapshot);
  const labels = groupLabels(snapshot);
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const byId = new Map(snapshot.groups.map((g) => [g.id, g]));
  const groups = only.length ? only.flatMap((id) => byId.get(id) ?? []) : snapshot.groups;
  return groups.map((group) => {
    const solved = priced?.next.byGroup[group.id] ?? null;
    // Walked from the fan the solve walked it from: the largest, when several root it.
    const tree = groupTree(
      snapshot,
      group.id,
      group.rootIds.length > 1 ? solved?.fans[0]?.unit : undefined,
      members,
    );
    const scopedRun =
      priced && members ? worstRun(priced.next, [group.id], new Set(tree.terminals)) : null;
    const peCritical = members ? (scopedRun?.terminal ?? null) : (solved?.critical ?? null);
    const longest = tree.longest.at(-1) ?? null;
    const fan = members
      ? solved?.implausible.some((id) => members.has(id))
        ? null
        : (scopedRun?.total ?? null)
      : (solved?.fan ?? null);
    const rootId = tree.root?.equipment ?? tree.root?.element ?? null;
    const rootName = rootId == null ? "no air mover" : name(rootId);
    const fans = solved?.fans ?? [];
    // The worst fan's run crosses its junction: that run is its own row, and it holds the ◆.
    const viaCritical =
      fans.find(
        (f) => f.unit === (members ? scopedRun?.unit : solved?.criticalFan) && f.viaJunction,
      ) ?? null;
    const viaRuns = fans.filter(
      (f) => f.viaJunction && f.critical != null && (!members || members.has(f.critical)),
    );
    const ownerOf = (terminal: number) =>
      fans.slice(1).find((f) => f.owned.includes(terminal))?.unit ?? rootId;
    type RunLoss = { total: number; tel: number | null; rows: Row[]; provisional: Provisional };
    const runNode = (
      run: { terminal: number; path: number[] },
      from: number | null,
      path: RunLoss | null,
      runKey: string,
      critical: TreeNode["critical"],
    ): TreeNode => {
      const fromName = from == null ? rootName : name(from);
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
      const legs = cut.legs.map((leg, i): TreeNode => {
        const members = [
          ...(i === 0 && leg.from.kind !== "open" && leg.from.kind !== "level"
            ? [leg.from.id]
            : []),
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
          name: i === 0 && leg.from.kind === "open" ? `${fromName} → ${leg.to.name}` : leg.name,
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
        name: `${fromName} → ${name(run.terminal)}`,
        level: snapshot.levels.find((l) => l.id === runLevel)?.name ?? null,
        id: run.terminal,
        total: path?.total ?? null,
        self: null,
        ft: path?.tel ?? null,
        selfFt: null,
        rate: null,
        unpriced: null,
        split: path ? splitOf(snapshot, path.rows, equipment) : null,
        scale: fan,
        critical,
        provisional: path?.provisional ?? null,
        terminal: run.terminal,
        children: legs,
      };
    };
    const runNodes = [
      ...runsOf(tree).map((run) => {
        const path = priced?.next.paths[run.terminal] ?? null;
        return runNode(
          // A smaller fan's own run is priced from its port: drawn on that path.
          { terminal: run.terminal, path: path?.path ?? run.path },
          ownerOf(run.terminal),
          path,
          `${group.id}/r${run.terminal}`,
          peCritical != null
            ? run.terminal === peCritical && !viaCritical
              ? "pe"
              : null
            : run.terminal === longest
              ? "longest"
              : null,
        );
      }),
      ...viaRuns.map((f: FanResult) =>
        runNode(
          { terminal: f.critical!, path: f.path },
          f.unit,
          {
            total: f.esp,
            tel: f.tel,
            rows: f.rows,
            provisional: priced?.next.paths[f.critical!]?.provisional ?? null,
          },
          `${group.id}/f${f.unit}/r${f.critical}`,
          f === viaCritical ? "pe" : null,
        ),
      ),
    ];
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
      split: runNodes.find((r) => r.critical === "pe")?.split ?? null,
      level: null,
      scale: fan,
      critical: null,
      provisional: solved?.provisional ?? null,
      terminal: null,
      children: runNodes.sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0)),
    };
  });
}
