/**
 * The profiler tree E2 reads: system -> runs (fan to terminal) -> legs (`legsOf` over the run's path) -> elements.
 * Loss comes only from `priced.now.paths`: an element's self is the sum of its rows' dp on that path, its
 * total the running sum from the fan. With no priced result every number is null (never a stand-in figure).
 */
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { Provisional } from "@pe/ducts-domain/losses";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { elementNamer } from "../../claims";
import { labelOfNode, legsOf } from "../../legs";

export type TreeKind = "system" | "run" | "leg" | "element";

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
  /** Bar scale: the group's fan. */
  scale: number | null;
  critical: "pe" | "longest" | null;
  provisional: Provisional;
  /** The run's terminal this node lies on (for the loss rows in the edit popover). */
  terminal: number | null;
  children: TreeNode[];
}

const sum = (values: (number | null)[]) =>
  values.some((v) => v == null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0);

export function buildTree(
  snapshot: DuctSnapshot,
  priced: Priced | null,
  work: DuctsRouteDocument | null,
  only = "",
): TreeNode[] {
  const nameOf = elementNamer(snapshot, null);
  const name = (id: number) => nameOf(id) ?? "element not in snapshot";
  const labelOf = labelOfNode(snapshot);
  return snapshot.groups.filter((g) => !only || g.id === only).map((group) => {
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
      const selfOf = (id: number) =>
        path
          ? path.rows.filter((r) => r.id === id).reduce((a, r) => a + (r.dp ?? 0), 0)
          : null;
      const running = new Map<number, number | null>();
      let acc = 0;
      for (const id of run.path) {
        const s = selfOf(id);
        acc += s ?? 0;
        running.set(id, path ? acc : null);
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
          name: leg.name,
          id: leg.ids[0] ?? leg.to.id,
          total: last == null ? null : (running.get(last) ?? null),
          self: sum(elements.map((e) => e.self)),
          scale: fan,
          critical: null,
          provisional: null,
          terminal: run.terminal,
          children: elements,
        };
      });
      return {
        key: runKey,
        kind: "run",
        name: `${rootName} → ${name(run.terminal)}`,
        id: run.terminal,
        total: path?.total ?? null,
        self: null,
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
      name: group.systemNames.slice(0, 2).join(", ") || group.classifications.join(", ") || rootName,
      id: rootId,
      total: fan,
      self: null,
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
  const blank = { total: null, self: null, scale: null, critical: null, provisional: null, terminal: null };
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

/** The system list: one childless row per group (no run tree is built, so 400 groups stay cheap). */
export function systemList(snapshot: DuctSnapshot, priced: Priced | null): TreeNode[] {
  const nameOf = elementNamer(snapshot, null);
  return snapshot.groups.map((group) => {
    const solved = priced?.now.byGroup[group.id] ?? null;
    const rootId = group.rootIds[0] ?? null;
    return {
      key: group.id,
      kind: "system",
      name:
        group.systemNames.slice(0, 2).join(", ") ||
        group.classifications.join(", ") ||
        (rootId == null ? "no air mover" : (nameOf(rootId) ?? group.id)),
      id: rootId,
      total: solved?.fan ?? null,
      self: null,
      scale: null,
      critical: null,
      provisional: solved?.provisional ?? null,
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
