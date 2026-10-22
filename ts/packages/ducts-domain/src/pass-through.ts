/**
 * A passive unit passes air through it (pressure-drop ledger, 2026-10-21, multi-fan spike).
 * `ducts.snapshot` cuts groups at every unit (DuctNetwork.cs), so a filter chassis between a return
 * plenum and its air handler splits one network into two groups and the air handler's critical
 * run stops at the filter (Project A RA 8, g11055286: FC-33 to filter FR-1; FR-1 on to g6312628).
 *
 * Here, for pricing only, every passive unit (`unit-roles.ts`) becomes an inline part: its ports
 * are one node, the groups its ports reach merge into one group under the merged group's fans,
 * and a non-passive unit its port meets directly becomes a root of that group. The unit prices as
 * a component (its stated drop, else nothing, `losses.ts`). Rules:
 * - The merged group's id is the lowest `g<id>` among the groups it merges (DuctNetwork's naming).
 * - Issues move to the merged group; one `multi-root` stands for it when it is fed by more than
 *   one root, and `no-root` goes once any root feeds it.
 * - A passive unit's port that connects to nothing is a person's fix (`open-end`, blocking): the
 *   model is missing that connection, so the air has no path through to the fan on that side.
 * Revit is untouched: the model's groups stay as they are; this is the route's reading.
 */
import type { DuctFinding } from "@pe/agent-contracts";

import { markOf } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";

type Group = DuctSnapshot["groups"][number];

export interface PassThrough {
  snapshot: DuctSnapshot;
  findings: DuctFinding[];
  /** Merged group id to the group ids it took in (two or more). */
  merged: Map<string, string[]>;
}

const num = (gid: string) => Number(gid.slice(1));

export function passThrough(snapshot: DuctSnapshot, passive: ReadonlySet<number>): PassThrough {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const holder = new Map<number, string>();
  for (const n of snapshot.nodes) if (n.groupId) holder.set(n.id, n.groupId);
  for (const s of snapshot.segments) if (s.groupId) holder.set(s.id, s.groupId);

  // Union-find over group ids; a passive unit joins the groups its ports reach.
  const up = new Map<string, string>();
  const find = (g: string): string => {
    const p = up.get(g) ?? g;
    if (p === g) return g;
    const r = find(p);
    up.set(g, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) up.set(num(x) < num(y) ? y : x, num(x) < num(y) ? x : y);
  };
  const findings: DuctFinding[] = [];
  const units = [...passive].filter((id) => nodes.get(id)?.kind === "equipment").sort((a, b) => a - b);
  const reach = new Map<number, string[]>();
  const directRoots = new Map<number, number[]>();
  for (const id of units) {
    const unit = nodes.get(id)!;
    const groups: string[] = [];
    const roots: number[] = [];
    for (const c of unit.connectors) {
      const to = c.connectedTo?.elementId;
      if (to == null) {
        findings.push({
          id: `open-end:passive:${id}:${c.index}`,
          kind: "open-end",
          elementIds: [id],
          note: `passive ${markOf(unit) ?? id} port ${c.index} connects to nothing: no path through it to a fan on that side; connect it in Revit`,
          assumed: null,
          clearer: "person",
        });
        continue;
      }
      const g = holder.get(to);
      if (g) groups.push(g);
      else if (nodes.get(to)?.kind === "equipment") roots.push(to);
    }
    reach.set(id, groups);
    directRoots.set(id, roots);
    for (const g of groups.slice(1)) join(groups[0]!, g);
  }
  const touched = units.filter((id) => (reach.get(id) ?? []).length > 0);
  if (!touched.length && !findings.length) return { snapshot, findings, merged: new Map() };

  const groupOf = new Map<number, string>();
  for (const id of touched) groupOf.set(id, find(reach.get(id)![0]!));
  const into = (g: string | null | undefined) => (g ? find(g) : g);
  const members = new Map<string, Group[]>();
  for (const g of snapshot.groups) {
    const r = find(g.id);
    members.set(r, [...(members.get(r) ?? []), g]);
  }
  const issueKind = new Map(snapshot.issues.map((i) => [i.id, i]));
  const groups: Group[] = [];
  const issues = [...snapshot.issues.map((i) => ({ ...i, groupId: find(i.groupId) }))];
  const merged = new Map<string, string[]>();
  for (const [id, list] of members) {
    const inline = touched.filter((u) => groupOf.get(u) === id);
    if (list.length === 1 && !inline.length) {
      groups.push(list[0]!);
      continue;
    }
    if (list.length > 1) merged.set(id, list.map((g) => g.id).sort((a, b) => num(a) - num(b)));
    const passing = new Set(inline);
    const rootIds = [
      ...new Set([
        ...list.flatMap((g) => g.rootIds),
        ...inline.flatMap((u) => (directRoots.get(u) ?? []).filter((r) => !passive.has(r))),
      ]),
    ]
      .filter((r) => !passing.has(r))
      .sort((a, b) => a - b);
    const kept = list
      .flatMap((g) => g.issueIds)
      .filter((iid) => {
        const kind = issueKind.get(iid)?.kind;
        return kind !== "multi-root" && !(kind === "no-root" && rootIds.length);
      });
    const multi = `multi-root:${id}`;
    if (rootIds.length > 1) {
      kept.push(multi);
      if (!issues.some((i) => i.id === multi))
        issues.push({
          id: multi,
          kind: "multi-root",
          elementId: null,
          point: null,
          groupId: id,
          note: `${rootIds.length} roots once passive units pass air through`,
        } as unknown as DuctSnapshot["issues"][number]);
    }
    groups.push({
      ...list[0]!,
      id,
      rootIds,
      classifications: [...new Set(list.flatMap((g) => g.classifications))].sort(),
      systemNames: [...new Set(list.flatMap((g) => g.systemNames))].sort(),
      terminalCount: list.reduce((a, g) => a + g.terminalCount, 0),
      elementCount: list.reduce((a, g) => a + g.elementCount, 0) + inline.length,
      loops: list.reduce((a, g) => a + g.loops, 0),
      issueIds: [...new Set(kept)],
    });
  }
  const live = new Set(groups.flatMap((g) => g.issueIds));
  const out: DuctSnapshot = {
    ...snapshot,
    groups: groups.sort((a, b) => num(a.id) - num(b.id)),
    nodes: snapshot.nodes.map((n) =>
      groupOf.has(n.id)
        ? { ...n, groupId: groupOf.get(n.id)! }
        : n.groupId && into(n.groupId) !== n.groupId
          ? { ...n, groupId: into(n.groupId)! }
          : n,
    ),
    segments: snapshot.segments.map((s) =>
      s.groupId && into(s.groupId) !== s.groupId ? { ...s, groupId: into(s.groupId)! } : s,
    ),
    issues: issues.filter(
      (i, k, all) =>
        all.findIndex((j) => j.id === i.id) === k &&
        (live.has(i.id) || !["multi-root", "no-root"].includes(i.kind)),
    ),
  };
  for (const f of findings) {
    const g = groupOf.get(f.elementIds[0]!);
    if (g) f.groupId = g;
  }
  return { snapshot: out, findings, merged };
}
