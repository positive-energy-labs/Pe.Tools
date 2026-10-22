/**
 * The /ducts subject is a Revit system, never a group (pressure-drop ledger, 2026-10-21). A system
 * spans every group it is in (`groups[].systemNames`); a group that carries several systems shows
 * under each, shared. What blocks the system is only what prices it: the runs from a fan to the
 * system's terminals, the system's own elements (its open ends), and the units on those runs.
 * Everything else inside a shared group is the other systems' and never blocks this one.
 */
import { markOf } from "./terminal-flows.ts";
import { groupTree, pathTo } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

type Snapshot = Pick<DuctSnapshot, "groups" | "nodes" | "segments"> &
  Partial<Pick<DuctSnapshot, "systems">>;

/** The picker's name for the groups no Revit system claims. */
export const NO_SYSTEM = "no system";

/** One pickable system: its name, classification, groups, and the tags of the units rooting them. */
export interface SystemEntry {
  name: string;
  classification: string | null;
  groups: string[];
  /** Unit tags (else family) of the groups' roots, in a person's words. */
  units: string[];
  terminals: number;
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const ownedBy = (name: string, systemName: string | null | undefined) =>
  name === NO_SYSTEM ? !systemName : systemName === name;

/** The groups a system is in, in snapshot order; `no system` is the groups no system claims. */
export const groupsOfSystem = (snapshot: Pick<DuctSnapshot, "groups">, name: string) =>
  snapshot.groups.filter((g) =>
    name === NO_SYSTEM ? g.systemNames.length === 0 : g.systemNames.includes(name),
  );

/** Every system the snapshot's groups carry, by name (SA 2 before SA 19), `no system` last. */
export function systemsOf(snapshot: Snapshot): SystemEntry[] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const classOf = new Map((snapshot.systems ?? []).map((s) => [s.name, s.classification]));
  const terminals = new Map<string, number>();
  for (const n of snapshot.nodes)
    if (n.kind === "terminal") {
      const key = n.systemName || NO_SYSTEM;
      terminals.set(key, (terminals.get(key) ?? 0) + 1);
    }
  const byName = new Map<string, SystemEntry>();
  for (const g of snapshot.groups)
    for (const name of g.systemNames.length ? g.systemNames : [NO_SYSTEM]) {
      const entry =
        byName.get(name) ??
        byName
          .set(name, {
            name,
            classification: name === NO_SYSTEM ? null : (classOf.get(name) ?? null),
            groups: [],
            units: [],
            terminals: terminals.get(name) ?? 0,
          })
          .get(name)!;
      entry.groups.push(g.id);
      for (const id of g.rootIds) {
        const node = nodes.get(id);
        const tag = markOf(node) ?? node?.family ?? null;
        if (tag && !entry.units.includes(tag)) entry.units.push(tag);
      }
    }
  return [...byName.values()].sort((a, b) =>
    a.name === NO_SYSTEM ? 1 : b.name === NO_SYSTEM ? -1 : natural.compare(a.name, b.name),
  );
}

export interface SystemScope {
  name: string;
  /** Every group the system is in. */
  groups: readonly string[];
  /** The groups that hold one of the system's terminals or elements: the ones whose runs price it. */
  pricing: ReadonlySet<string>;
  /** Per group, the other systems it carries; absent when the group is the system's alone. */
  shared: ReadonlyMap<string, readonly string[]>;
  /** The system's terminals. */
  terminals: ReadonlySet<number>;
  /** The units on the runs that price the system. */
  units: ReadonlySet<number>;
  /** What can block the system: its runs (fan to its terminals), its own elements, its units. */
  prices: ReadonlySet<number>;
  /** Every element of every group the system is in, roots included: what the page shows. */
  members: ReadonlySet<number>;
}

const scopes = new WeakMap<object, Map<string, SystemScope>>();

/** The system's groups and what in them prices it; cached per snapshot. */
export function systemScope(snapshot: DuctSnapshot, name: string): SystemScope {
  const cache = scopes.get(snapshot) ?? scopes.set(snapshot, new Map()).get(snapshot)!;
  const hit = cache.get(name);
  if (hit) return hit;
  const groups = groupsOfSystem(snapshot, name);
  const ids = new Set(groups.map((g) => g.id));
  const members = new Set<number>();
  const own = new Set<number>();
  const terminals = new Set<number>();
  const pricing = new Set<string>();
  for (const e of [...snapshot.nodes, ...snapshot.segments]) {
    if (!e.groupId || !ids.has(e.groupId)) continue;
    members.add(e.id);
    if (!ownedBy(name, e.systemName)) continue;
    own.add(e.id);
    pricing.add(e.groupId);
    if ("kind" in e && e.kind === "terminal") terminals.add(e.id);
  }
  const units = new Set<number>();
  const prices = new Set(own);
  for (const g of groups) {
    for (const r of g.rootIds) members.add(r);
    if (!pricing.has(g.id)) continue;
    const tree = groupTree(snapshot, g.id);
    for (const t of tree.terminals)
      if (terminals.has(t)) for (const id of pathTo(tree.parent, t)) prices.add(id);
    // The units whose port feeds one of those runs; a group the walk roots at none keeps its roots.
    const ports = [tree.root, ...tree.extraRoots].filter((p) => p?.equipment != null);
    const fed = ports.filter((p) => prices.has(p!.element)).map((p) => p!.equipment!);
    for (const u of fed.length ? fed : g.rootIds) units.add(u);
  }
  for (const u of units) prices.add(u);
  const shared = new Map(
    groups.flatMap((g) => {
      const others = g.systemNames.filter((n) => n !== name);
      return others.length ? [[g.id, others] as const] : [];
    }),
  );
  const scope: SystemScope = {
    name,
    groups: groups.map((g) => g.id),
    pricing,
    shared,
    terminals,
    units,
    prices,
    members,
  };
  cache.set(name, scope);
  return scope;
}

/** The system a group is read under: its first system name, else `no system`. */
export const systemOfGroup = (snapshot: Pick<DuctSnapshot, "groups">, group: string) =>
  snapshot.groups.find((g) => g.id === group)?.systemNames[0] ?? NO_SYSTEM;

/**
 * "SA 19 · FC-17": each group of a system named by the system and the units rooting it; two that
 * read the same are numbered ("SA 19 · no fan 2"), never told apart by a group id.
 */
export function sectionNames(
  snapshot: Pick<DuctSnapshot, "groups" | "nodes">,
  system: string,
): Map<string, string> {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const base = groupsOfSystem(snapshot, system).map((g) => {
    const units = [
      ...new Set(g.rootIds.map((id) => markOf(nodes.get(id)) ?? nodes.get(id)?.family ?? "unit")),
    ];
    return [g.id, `${system} · ${units.length ? units.join(", ") : "no fan"}`] as const;
  });
  const total = new Map<string, number>();
  for (const [, label] of base) total.set(label, (total.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    base.map(([id, label]) => {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      return [id, total.get(label)! > 1 && n > 1 ? `${label} ${n}` : label];
    }),
  );
}
