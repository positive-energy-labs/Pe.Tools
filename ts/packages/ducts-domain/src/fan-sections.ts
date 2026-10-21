/**
 * Which fan owns which part of a multi-fan group (pressure-drop ledger, 2026-10-21, multi-fan
 * spike; kaitpw wants several fans priced in Pe's own calc, a departure from one fan per system).
 *
 * The rule, deterministic and topological:
 * 1. Fans are the group's roots that are not passive (`unit-roles.ts`), ordered by design flow,
 *    largest first, then by element id. Passive units own nothing; they price as inline parts.
 *    A fan that states no flow reads the sum of the grilles it serves in this group (`groupFans`).
 * 2. The tree is rooted at the largest fan's port. It owns the shared trunk: everything no smaller
 *    fan claims.
 * 3. Each smaller fan, largest first, claims its port element and everything beyond it (away from
 *    the root), then walks toward the root and claims each element until the next one is a
 *    JUNCTION: a branch point (two or more children), the root, or an element a larger fan already
 *    claimed. That junction is where its air meets a larger fan's; the junction stays the larger
 *    fan's.
 * 4. Flows: a smaller fan's own stretch carries its design flow; past the junction its air is part
 *    of the terminal demand the larger fan's section already carries, never added on top.
 * 5. Pricing (`losses.ts`): each fan's critical run is the worst of its own runs (terminals in its
 *    section) and, for a smaller fan, its stretch plus the larger section's worst run from the
 *    junction on. Each fan gets its own TEL and ESP.
 */
import { pathTo, type GroupTree } from "./topology.ts";

export interface Fan {
  unit: number;
  /** Design flow, cfm; null when the unit states none (it sorts last). */
  cfm: number | null;
}

export interface FanSection extends Fan {
  /** The element its port feeds; null when the unit has no port in the tree. */
  port: number | null;
  /** Where its air meets a larger fan's; null for the largest fan (it owns the trunk). */
  junction: number | null;
  /** The elements it owns: for a smaller fan, its port to the junction (exclusive) and beyond the port. */
  owned: number[];
}

/** A branch point: two or more children in the tree rooted at the largest fan. */
export const BRANCH_CHILDREN = 2;

/** The fans, largest design flow first, then lowest id. */
export const byFlow = <F extends Fan>(fans: readonly F[]): F[] =>
  [...fans].sort((a, b) => (b.cfm ?? -1) - (a.cfm ?? -1) || a.unit - b.unit);

const portOf = (tree: GroupTree, unit: number) =>
  [tree.root, ...tree.extraRoots]
    .filter((p) => p?.equipment === unit)
    .sort((a, b) => a!.port! - b!.port!)[0]?.element ?? null;

/**
 * The sections of `tree`, which must be rooted at the largest fan's port (`groupTree(…, unit)`).
 * The first section is the largest fan's; it owns every element no other section does.
 */
export function fanSections(tree: GroupTree, fans: readonly Fan[]): FanSection[] {
  const [first, ...rest] = byFlow(fans);
  if (!first) return [];
  const owner = new Map<number, number>();
  const sections: FanSection[] = [];
  for (const fan of rest) {
    const port = portOf(tree, fan.unit);
    const owned: number[] = [];
    let junction: number | null = null;
    if (port != null && !owner.has(port) && port !== tree.root?.element) {
      const beyond = [port];
      while (beyond.length) {
        const x = beyond.pop()!;
        if (owner.has(x)) continue;
        owned.push(x);
        beyond.push(...(tree.children.get(x) ?? []));
      }
      for (let x = tree.parent.get(port); x != null; x = tree.parent.get(x)) {
        const meets =
          x === tree.root?.element ||
          owner.has(x) ||
          (tree.children.get(x)?.length ?? 0) >= BRANCH_CHILDREN;
        if (meets) {
          junction = x;
          break;
        }
        owned.push(x);
      }
    } else if (port != null) junction = port;
    for (const id of owned) owner.set(id, fan.unit);
    sections.push({ ...fan, port, junction, owned });
  }
  const trunk = tree.order.filter((id) => !owner.has(id));
  return [
    { ...first, port: tree.root?.element ?? null, junction: null, owned: trunk },
    ...sections,
  ];
}

/**
 * The terminals each fan serves, to derive a flow for a fan that states none: every terminal goes
 * to the fan whose port is fewest hops away (ties to the lower unit id). Pure on the tree.
 */
export function servedBy(tree: GroupTree, units: readonly number[]): Map<number, number[]> {
  const owner = new Map<number, number>();
  const queue: number[] = [];
  for (const unit of [...units].sort((a, b) => a - b)) {
    const port = portOf(tree, unit);
    if (port != null && !owner.has(port)) {
      owner.set(port, unit);
      queue.push(port);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head]!;
    const near = [...(tree.children.get(x) ?? []), tree.parent.get(x)].filter(
      (y): y is number => y != null && !owner.has(y),
    );
    for (const y of near) {
      owner.set(y, owner.get(x)!);
      queue.push(y);
    }
  }
  const out = new Map<number, number[]>(units.map((u) => [u, []]));
  for (const t of tree.terminals) {
    const u = owner.get(t);
    if (u != null) out.get(u)!.push(t);
  }
  return out;
}

/**
 * A group's fans with their design flows: the stated one, else the sum of the terminal flows the
 * fan serves in this group (`servedBy`), `served` naming them; a fan serving none states none.
 * Never another group's sum: a unit rooting a supply and a return group derives each from that
 * group's own grilles (SA 19, Chadds: DH-21 read 768 cfm from RA 38's return grilles, outranked
 * FC-17 and took its trunk).
 */
export function groupFans(
  tree: () => GroupTree,
  units: readonly number[],
  stated: (unit: number) => number | null | undefined,
  terminalCfm: (terminal: number) => number,
): (Fan & { served: number[] | null })[] {
  const known = units.map((unit) => ({ unit, cfm: stated(unit) ?? null }));
  if (known.every((f) => f.cfm != null)) return known.map((f) => ({ ...f, served: null }));
  const served = servedBy(tree(), units);
  return known.map((f) => {
    if (f.cfm != null) return { ...f, served: null };
    const ts = served.get(f.unit) ?? [];
    const cfm = ts.reduce((a, t) => a + terminalCfm(t), 0);
    return cfm > 0 ? { unit: f.unit, cfm, served: ts } : { unit: f.unit, cfm: null, served: null };
  });
}

/** A smaller fan's own stretch, port first, toward its junction (the order its air runs). */
export const stretchOf = (tree: GroupTree, section: FanSection): number[] => {
  if (section.port == null || section.junction == null) return [];
  const up = pathTo(tree.parent, section.port).reverse();
  return up.slice(0, up.indexOf(section.junction));
};
